import { createElement } from "react";
import { Check, DownloadSimple, MapTrifold } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import ComponentsSplit from "./ComponentsSplit.jsx";
import ModName from "../ModName.jsx";
import PartActions from "./PartActions.jsx";
import { partFace, renderedFace } from "./part-face.jsx";
import { formatModSize } from "../../../../catalog-utils.js";
import { requestDownloadsPanel } from "../../../../features/downloads/open-requests.js";
import { mappingPieceWords, mappingSetWords } from "../../../../features/catalog/mapping-sets.js";

// Куда «лететь» установке: первая картинка панели части, а вне панели — сама кнопка.
const flightFrom = (button) => button.closest("[data-part-root]")?.querySelector("img") ?? button;

// Что делает кнопка в каждом состоянии: стоит — ничего; всё в пути — просит «Загрузки»; иначе ставит недостающее.
const CLICKS = {
  installed: () => undefined,
  queued: () => () => {
    requestDownloadsPanel();
  },
  idle: (missing, parts) => (event) => {
    const source = flightFrom(event.currentTarget);
    missing.forEach((piece) => parts.install(piece, source));
  },
};

// Занятые — записи очереди без снятия и без сбоя; недостающие — не стоят и не заняты.
function planInstall(pieces, parts) {
  const claimed = new Set();
  parts.queue.forEach((entry) => {
    if (entry.operation !== "remove" && !entry.failed) claimed.add(entry.id);
  });
  const stands = (piece) => parts.installed.includes(piece.id);
  const missing = pieces.filter((piece) => !stands(piece) && !claimed.has(piece.id));
  if (pieces.every(stands)) return { state: "installed", missing };
  return { state: missing.length === 0 ? "queued" : "idle", missing };
}

function InstallAll({ pieces, parts, words, wide }) {
  const { state, missing } = planInstall(pieces, parts);
  const done = state === "installed";
  const label = done ? words.installedAll : words.installAll;
  const onClick = CLICKS[state](missing, parts);
  const look = {
    variant: done || wide ? "secondary" : "primary",
    size: wide ? "sm" : "md",
    className: wide ? `mod-mapping-install is-${state}` : `mod-part-action is-install is-labelled is-${state}`,
    icon: createElement(done ? Check : DownloadSimple, { weight: "bold" }),
    ariaLabel: label,
    title: label,
    "aria-disabled": onClick ? undefined : "true",
    "aria-busy": state === "queued" ? "true" : undefined,
    onClick,
  };
  return <Button {...look}>{label}</Button>;
}

// Лицо записи: значок карты, а обложка из лица (если есть) поверх.
const mapFace = (face) => ({ media: createElement(MapTrifold, { weight: "regular" }), ...face });

// Поля записи куска набора (порядок ключей важен); каждое считается из общего разбора.
const PIECE_FIELDS = [
  ["key", ({ piece }) => piece.id],
  ["title", ({ name }) => createElement(ModName, { name })],
  ["sub", ({ weight }) => weight],
  ["kicker", ({ kind }) => kind],
  ["ariaLabel", ({ kind, name }) => [kind, name].filter(Boolean).join(": ")],
  ["face", ({ piece }) => mapFace(renderedFace(piece))],
  ["weight", ({ weight }) => weight],
  ["installed", ({ piece, view }) => view.parts.installed.includes(piece.id)],
  ["actions", ({ piece, view, copy }) => <PartActions part={piece} parts={view.parts} copy={copy} editorCopy={view.cardCopy.editor} />],
  ["onOpen", ({ piece, item, view }) => (!item.current && view.parts.open ? () => { view.parts.open(piece); } : null)],
];

function pieceEntry(item, view, copy) {
  const piece = item.mod;
  const { kind, name } = mappingPieceWords(piece, view.language);
  const weight = formatModSize(piece, view.rails.allMods, view.locale) || null;
  const known = { item, piece, view, copy, kind, name, weight };
  return Object.fromEntries(PIECE_FIELDS.map(([field, make]) => [field, make(known)]));
}

export default function MappingSet({ view, items, copy }) {
  const words = mappingSetWords(view.language);
  const pieces = items.map((item) => item.mod);
  const entries = items.map((item) => pieceEntry(item, view, copy));
  const initial = items.find((item) => item.current)?.mod.id ?? "";

  return createElement(
    "section",
    { className: "mod-card-section mod-contents mod-mapping-set", "aria-labelledby": "mod-mapping-set-title" },
    createElement("header", null, createElement("h2", { id: "mod-mapping-set-title" }, words.set), createElement("small", null, copy.parts(pieces.length)), <InstallAll pieces={pieces} parts={view.parts} words={words} wide />),
    <ComponentsSplit entries={entries} initial={initial} />,
  );
}

// Поля записи набора на странице редукса.
const SET_FIELDS = [
  ["key", ({ item }) => item.mod.id],
  ["title", ({ words }) => createElement(ModName, { name: words.kind })],
  ["sub", ({ count }) => count],
  ["ariaLabel", ({ words, count }) => `${words.kind}: ${count}`],
  ["face", ({ item }) => mapFace(partFace(item.mod))],
  ["meta", ({ count }) => count],
  ["installed", ({ item, view }) => item.pieces.every((piece) => view.parts.installed.includes(piece.id))],
  ["actions", ({ item, view, words }) => createElement("span", { className: "mod-part-actions is-panel" }, <InstallAll pieces={item.pieces} parts={view.parts} words={words} />)],
  ["onOpen", ({ item, view }) => (view.parts.open ? () => { view.parts.open(item.mod); } : null)],
];

export function mappingSetEntry(item, view, copy) {
  const words = mappingSetWords(view.language);
  const known = { item, view, words, count: copy.parts(item.pieces.length) };
  return Object.fromEntries(SET_FIELDS.map(([field, make]) => [field, make(known)]));
}
