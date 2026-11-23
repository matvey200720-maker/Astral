import { Storefront, Palette, Lightning, Images, ImageSquare } from "../../../components/ui/icons.jsx";
import Select from "../../../components/ui/Select.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ItemsPanel, { useItemAction } from "../items-panel/ItemsPanel.jsx";
import SectionHeading from "../section-help.jsx";
import { StudioButton } from "../finish/FinishField.jsx";
import { ReplaceCard } from "./arena-replace-section.jsx";
import { ARENA_SWATCHES } from "./arena-text.js";
import { shellRoomKey, shellRoomBlocked as roomBlocked, shellPaintOf, SHELL_PAINT_ALL } from "./arena-shell-paint.js";
import MassReplace from "./arena-mass-replace.jsx";
import { massScreenTypes } from "./arena-mass-replace.js";
import { arenaItemLookAdapter } from "./arena-item-looks.js";
import { arenaItemElements } from "./arena-item-parts.js";
import ItemLook, { MultiLook, ElementLook } from "./arena-item-look.jsx";
import { wallMaterialName, shellPartName, roomNumberOf, entityBounds } from "./arena-items.js";
import {
  arenaRoomOrder,
  arenaRoomOf,
  arenaRoomLabel,
  arenaModelTitleParts,
  arenaItemCategory,
  ARENA_ITEM_CATEGORIES,
} from "./arena-item-categories.js";
import { useTr, tr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { arenaSectionLabel, arenaScene } from "@modovik/climb-contract/recolor/arenas";
import { arenaReplaceables } from "@modovik/climb-contract/recolor/arena-replace";
import { itemElementOf } from "@modovik/climb-contract/recolor/item-elements";
import { arenaItemGroupOf } from "@modovik/climb-contract/recolor/arena-item-looks";
import { arenaItemIsGroup } from "@modovik/climb-contract/recolor/arena-item-parts";
import {
  arenaObjectsRemovable,
  arenaObjects,
  arenaObjectScreens,
  arenaObjectScope,
  arenaObjectReplaceable,
  arenaObjectRemoval,
} from "@modovik/climb-contract/recolor/arena-objects";
import { useState, useMemo, useEffect, createElement as h } from "react";

// ---- слова, таблицы ----

const HINTS = {
  shellRoom: "Эта стена красится только во всей арене: своего листа в этой комнате у неё нет",
  screenless:
    "Картинку этого экрана рисует сама игра, отдельного листа для неё в файлах зала нет. Весь предмет можно заменить своей моделью, цветом или картинкой.",
  part: "Коврики лежат в одной модели игры с перилами. Убрать их можно отдельно от перил; цвет и своя модель — у перил, и тогда ковриков у них нет",
  group:
    "В одной модели игры стоят несколько предметов: убрать или заменить можно только все разом. По одному правятся картинки — в «Плакатах», «Табличках», «Экранах» и «Эмблемах зала»",
};

// инструмент, строка, пояснение по «?», значок, категории, где ссылка видна
const TOOL_ROWS = [
  [
    "seats",
    "Открыть «Кресла»",
    "Цвет всех кресел зала разом — в «Креслах»: листы кресел перекрашиваются, рисунок на них остаётся.",
    Palette,
    ["seats", "chairs"],
  ],
  [
    "lights",
    "Открыть «Подсветка»",
    "Цвет светящихся полос залов задаётся в «Отделке → Подсветка» сразу для всех.",
    Lightning,
    ["light"],
  ],
  [
    "posters",
    "Открыть «Картины и баннеры»",
    "Плакаты и баннеры зала правятся в «Рисунках»: своя картинка на каждый.",
    Images,
    ["posters"],
  ],
  [
    "objects",
    "Открыть «Торговые автоматы»",
    "Автоматы, банкоматы и паркоматы убираются по видам в «Предметах → Торговые автоматы».",
    Storefront,
    ["tech"],
  ],
];

const ITEM_LINKS = Object.freeze(
  TOOL_ROWS.reduce(function (table, row) {
    row[4].forEach(function (category) {
      table[category] = row.slice(0, 4);
    });
    return table;
  }, {})
);

const PART_NOTES = new Map([
  ["picture", (group) => group.model?.name || tr("Своя картинка")],
  ["model", () => tr("Своя модель")],
  ["colour", (group) => group.colour.toUpperCase()],
  ["removed", () => tr("Убрана")],
]);

// Необязательные пропсы раздела: пустое значение — null, только вместо undefined.
const OPTIONAL_PROPS = [
  "renderSeats",
  "removed",
  "onRemove",
  "onRestore",
  "looks",
  "onLook",
  "onShellPaint",
  "shellPaint",
  "screenSettings",
  "home",
  "onTool",
  "onHover",
  "partsOf",
  "onPiece",
  "onElement",
  "onToggle",
  "surfaces",
  "onSurface",
];

// Пропсы ArenaItemEditor, которые оболочка получает как есть.
const SHELL_PROPS = [
  "server",
  "asset",
  "item",
  "model",
  "scope",
  "selection",
  "shellPaint",
  "onShellPaint",
  "onSelect",
  "surfaces",
  "onSurface",
  "onNotice",
];

// Пропсы раздела, которые ArenaItemEditor получает с теми же именами.
const EDITOR_PROPS = [
  "server",
  "asset",
  "replace",
  "onSection",
  "onNotice",
  "renderScreens",
  "renderSeats",
  "onShellPaint",
  "shellPaint",
  "onTool",
  "looks",
  "onLook",
  "removed",
  "onSelect",
  "surfaces",
  "onSurface",
];

// Пропсы раздела, которые уходят панели без изменений.
const PANEL_PROPS = [
  "shots",
  "asset",
  "home",
  "selection",
  "onSelect",
  "onScope",
  "onFind",
  "removed",
  "partsOf",
  "onPiece",
  "onElement",
  "onHover",
  "onToggle",
];

// ---- мелкие функции ----

const fill = trFill;

function pick(source, names) {
  const out = {};
  for (const name of names) out[name] = source[name];
  return out;
}

function withDefaults(given) {
  const full = Object.assign({}, given);
  for (const name of OPTIONAL_PROPS) {
    if (full[name] === undefined) full[name] = null;
  }
  return full;
}

function isStructure(model) {
  return model.kind === "structure";
}

function shellSurfaceOf(name) {
  switch (shellPartName(name)) {
    case "Пол":
      return "floor";
    case "Потолок":
      return "ceiling";
    default:
      return "walls";
  }
}

function elementNoteOf(element) {
  if (!element) return null;
  const { picture, colour } = element;
  if (picture) return picture.name || tr("Своя картинка");
  if (colour) return colour.toUpperCase();
  return null;
}

function partNoteOf(group) {
  const make = PART_NOTES.get(group?.kind);
  return make ? make(group) : null;
}

function modelTitle(model) {
  const part = isStructure(model) && shellPartName(model.name);
  if (!part) return trFill(...arenaModelTitleParts(model));
  const room = roomNumberOf(model.name);
  if (!room) return tr(part);
  return [tr(part), tr("комната {0}").replace("{0}", room)].join(", ");
}

function wallsHint(wholeArena) {
  if (wholeArena) return tr("Стены этого материала во всей арене");
  return tr("Стены этого материала в этой комнате");
}

function replaceHint(count) {
  let text;
  if (count > 1) {
    text = tr("Модель правится у всех таких предметов разом ({0} шт.) — так игра ставит модель. Вместе с ней уходит и экран на ней.");
  } else {
    text = tr("Модель правится целиком. Вместе с ней уходит и экран на ней; картинка на экране правится отдельно.");
  }
  return text.replace("{0}", count);
}

function noteFor(kind, count) {
  // Строки считаются при вызове: язык окна меняется.
  const forms = {
    remove: [tr("Предмет убран из зала"), (n) => fill("Предметы убраны из зала ({0})", n)],
    restore: [tr("Предмет возвращён"), (n) => fill("Предметы возвращены ({0})", n)],
  };
  const [one, many] = forms[kind];
  return count > 1 ? many(count) : one;
}

// Одинаковые названия материалов различаем номером по порядку.
function materialOptions(materials) {
  const names = materials.map(function (entry) {
    return tr(wallMaterialName(entry));
  });
  const total = new Map();
  for (const name of names) total.set(name, (total.get(name) || 0) + 1);
  const used = new Map();
  const options = [];
  for (let at = 0; at < materials.length; at += 1) {
    const name = names[at];
    const nth = (used.get(name) || 0) + 1;
    used.set(name, nth);
    options.push([materials[at], total.get(name) > 1 ? name + " " + nth : name]);
  }
  return options;
}

function linkEntry(link, onTool) {
  const id = link[0];
  const Icon = link[3];
  return {
    id,
    icon: h(Icon),
    title: tr(link[1]),
    hint: tr(link[2]),
    onOpen() {
      return onTool(id);
    },
  };
}

function navRowProps(entry) {
  const { id, icon, title, onOpen } = entry;
  return { key: id, icon, title, "aria-label": title, onOpen };
}

function withElementColour(entry, found) {
  const colour = found && found.colour;
  return colour ? Object.assign({}, entry, { colour }) : entry;
}

// ---- поверхность в студии, слова панели ----

export function surfaceStudio(server, id) {
  const side = id === "facade" ? "outside" : "inside";
  return {
    id: "arena:" + server + ":" + id + ":sheet",
    title: tr("Арена") + " · " + arenaSectionLabel(server, id),
    scene: arenaScene(server, side)?.url,
    match(info) {
      return info.group === id;
    },
    path: [server, id],
  };
}

function wideRulesOf(server) {
  function blocked(model, selection, item) {
    const room = item == null ? undefined : item.room;
    const material = selection == null ? undefined : selection.material;
    return roomBlocked(server, model.kind, room, material);
  }
  return {
    wideScopes(model, selection, item) {
      if (!isStructure(model)) {
        if (model.count < 2) return [];
        return null;
      }
      if (!selection || !selection.material) return [];
      return ["room", "arena"].slice(blocked(model, selection, item) ? 1 : 0);
    },
    wideDefault(model, selection, item) {
      if (!isStructure(model)) return null;
      return blocked(model, selection, item) ? null : "room";
    },
    wideOnly: isStructure,
    allHint(model, selection) {
      if (!isStructure(model)) return null;
      return wallsHint(Boolean(selection) && selection.scope === "arena");
    },
  };
}

function arenaAdapter(server) {
  const words = {};
  words.categories = ARENA_ITEM_CATEGORIES;
  words.categoryOf = arenaItemCategory;
  words.roomOf = arenaRoomOf;
  words.roomOrder = arenaRoomOrder;
  words.roomLabel = function (id) {
    return arenaRoomLabel(id, tr, fill);
  };
  words.titleOf = modelTitle;
  words.originOf = function (model) {
    if (model.own) return tr("модель сервера");
    return tr("штатная модель игры");
  };
  return Object.assign(words, wideRulesOf(server));
}

// ---- хуки раздела ----

function useLookAdapter(server, asset) {
  return useMemo(
    function () {
      return arenaItemLookAdapter(server, asset);
    },
    [server, asset]
  );
}

function useScreens(server, bounds) {
  return useMemo(
    function () {
      return arenaObjectScreens(server, bounds);
    },
    [server, bounds]
  );
}

// Экраны всех вещей охвата, без повторов по ключу экрана.
function* screensOfKeys(server, boxes, keys) {
  for (const key of keys) yield* arenaObjectScreens(server, boxes.get(key) ?? null);
}

function collectTargets(server, asset, itemKey, scope) {
  const found = new Map();
  const screens = screensOfKeys(server, entityBounds(asset), arenaObjectScope(server, itemKey, scope));
  for (const screen of screens) found.set(screen.key, screen);
  return Array.from(found.values());
}

function useTargets(server, asset, itemKey, scope, screens) {
  return useMemo(
    function () {
      return scope === "one" ? screens : collectTargets(server, asset, itemKey, scope);
    },
    [server, itemKey, scope, asset, screens]
  );
}

// Хуки редактора предмета в том же порядке: вкладка, экраны, цели, облик.
function useEditorHooks(props) {
  const out = { tabState: useState("screen") };
  const { server, asset, item, scope } = props;
  out.screens = useScreens(server, entityBounds(asset).get(item.key) || null);
  out.targets = useTargets(server, asset, item.key, scope, out.screens);
  out.lookAdapter = useLookAdapter(server, asset);
  return out;
}

function useSectionView(p) {
  const { server, asset } = p;
  const out = {};
  const removed = p.removed;
  out.removedSet = useMemo(
    function () {
      return new Set(removed || []);
    },
    [removed]
  );
  out.replaceables = useMemo(
    function () {
      return arenaReplaceables(server);
    },
    [server]
  );
  out.adapter = useMemo(
    function () {
      return arenaAdapter(server);
    },
    [server]
  );
  out.lookAdapter = useLookAdapter(server, asset);
  const massState = useState(false);
  out.mass = massState[0];
  out.setMass = massState[1];
  const mass = out.mass;
  out.groups = useMemo(
    function () {
      return mass ? massScreenTypes(server, asset) : [];
    },
    [mass, server, asset]
  );
  return out;
}

// ---- оболочка зала ----

function useShellMaterials(asset, itemKey) {
  return useMemo(
    function () {
      const bounds = entityBounds(asset).get(itemKey);
      return bounds ? Array.from(bounds.textures || []) : [];
    },
    [asset, itemKey]
  );
}

// Строку списка открывают без материала: берём первый, чтобы «Цвету» было что красить.
function useFirstMaterial(props, materials, material) {
  const key = props.item.key;
  const onSelect = props.onSelect;
  useEffect(
    function () {
      if (!material && materials.length) {
        if (onSelect) onSelect(key, undefined, materials[0]);
      }
    },
    [material, materials, key, onSelect]
  );
}

// Что считается из пропсов оболочки и друг из друга, по порядку.
const SHELL_DERIVED = [
  ["blocked", (s, p) => (s.material ? roomBlocked(p.server, p.model.kind, p.item.room, s.material) : false)],
  ["wholeArena", (s, p) => p.scope === "arena" || s.blocked],
  ["paintRoom", (s, p) => (s.wholeArena ? SHELL_PAINT_ALL : shellRoomKey(p.item.room))],
  ["colour", (s, p) => (s.material ? shellPaintOf(p.shellPaint, s.paintRoom, s.material) : null)],
  ["surface", (s, p) => shellSurfaceOf(p.model.name)],
  ["settings", (s, p) => (p.surfaces && p.surfaces[s.surface]) || null],
  ["pictured", (s) => Boolean(s.settings && s.settings.mode === "image" && s.settings.image?.asset)],
];

function useShellState(props) {
  useTr();
  const state = { materials: useShellMaterials(props.asset, props.item.key) };
  state.material = props.selection.material || null;
  useFirstMaterial(props, state.materials, state.material);
  for (const [name, compute] of SHELL_DERIVED) state[name] = compute(state, props);
  state.actions = shellActions(props, state);
  return state;
}

function shellActions(props, state) {
  const onShellPaint = props.onShellPaint;
  const onSurface = props.onSurface;
  const paint = function (value) {
    return onShellPaint ? onShellPaint(state.paintRoom, state.material, value) : undefined;
  };
  return {
    paint,
    clear() {
      return paint(null);
    },
    unpicture() {
      const label = arenaSectionLabel(props.server, state.surface) + ": как в игре";
      return onSurface ? onSurface(state.surface, { mode: "standard" }, label) : undefined;
    },
  };
}

function colourRowOf(props, state, actions) {
  const own = { key: props.item.key + ":" + state.material, label: tr("Цвет стен") };
  const look = { value: state.colour, colours: ARENA_SWATCHES };
  const handlers = { onChange: actions.paint, onClear: actions.clear };
  return h(ColourRow, Object.assign(own, look, handlers, { "data-item-look": "colour" }));
}

function pictureRowOf(state, actions) {
  return h(ListRow, {
    icon: h(ImageSquare),
    title: tr("Своя картинка"),
    caption: state.settings.image.name || tr("из файла"),
    onClear: actions.unpicture,
    "data-item-look": "shell-picture",
  });
}

function studioRowOf(props, state) {
  const { server, onNotice, onSurface } = props;
  const { settings, surface } = state;
  const studio = { studio: surfaceStudio(server, surface), label: arenaSectionLabel(server, surface) };
  const mode = { mode: settings.mode, image: settings.image || {} };
  const wiring = {
    onChange(patch, label) {
      return onSurface(surface, patch, label);
    },
    onNotice,
  };
  const words = { title: tr("Нарисовать в студии"), caption: tr("Кисть, слои, текст") };
  return h(StudioButton, Object.assign(studio, mode, wiring, words));
}

function materialPickerOf(props, state) {
  const onSelect = props.onSelect;
  const itemKey = props.item.key;
  return h(Select, {
    label: tr("Материал"),
    ariaLabel: tr("Материал стен"),
    value: state.material,
    options: materialOptions(state.materials),
    onChange(next) {
      if (onSelect) onSelect(itemKey, undefined, next);
    },
  });
}

function ShellEditor(props) {
  const state = useShellState(props),
    { actions, colour, pictured } = state;

  let revert = null;
  if (colour || pictured) {
    revert = { label: tr("Вернуть как в игре") };
    revert.run = function () {
      if (colour) actions.clear();
      if (pictured) actions.unpicture();
    };
  }
  useItemAction("shell", revert);

  const notes = [wallsHint(state.wholeArena)];
  if (state.blocked && props.scope === "room") notes.push(tr(HINTS.shellRoom));
  notes.push(tr("Одну часть оболочки не красят."));

  const rows = [];
  if (state.material) rows.push(colourRowOf(props, state, actions));
  if (pictured && props.onSurface) rows.push(pictureRowOf(state, actions));
  if (state.settings && props.onSurface) rows.push(studioRowOf(props, state));

  const parts = [];
  if (state.materials.length > 1 && state.material) parts.push(materialPickerOf(props, state));
  parts.push(h(ListGroup, { title: tr("Заменить"), help: notes.join(". ") }, ...rows));
  return h("div", { className: "recolor-subsection arena-shell-paint", "data-items-editor": "shell" }, ...parts);
}

// ---- органы правки выбранного предмета ----

function editorContext(props, hooks) {
  const { element, model } = props;
  const elements = arenaItemElements(props.asset, props.server, props.item.key);
  const ctx = Object.assign({ props, elements }, hooks);
  ctx.hasScreens = ctx.screens.length > 0;
  ctx.byRows = ctx.hasScreens && elements.length > 1;
  ctx.category = arenaItemCategory(model);
  ctx.picked = null;
  if (element) {
    ctx.picked =
      elements.find(function (entry) {
        return entry.texture === element.texture;
      }) || null;
  }
  return ctx;
}

function drawScreens(ctx) {
  const draw = ctx.props.renderScreens;
  return draw(ctx.screens, ctx.targets);
}

function screenSheet(ctx) {
  return h("div", { className: "items-editor", "data-items-editor": "screen" }, drawScreens(ctx));
}

function lookPropsOf(ctx) {
  const { props } = ctx;
  const shared = pick(props, ["item", "scope", "looks", "removed", "onLook", "onNotice"]);
  return Object.assign(shared, { adapter: ctx.lookAdapter, name: modelTitle(props.model) });
}

// Страницы, которые заменяют весь редактор; берётся первая подошедшая.
function shortcutPage(ctx) {
  const { props } = ctx;
  const { model, element, onLook } = props;
  const rows = [
    [isStructure(model), () => h(ShellEditor, pick(props, SHELL_PROPS))],
    [model.part, () => h(SectionHeading, { help: tr(HINTS.part) })],
    [ctx.picked && ctx.picked.screen && ctx.hasScreens, () => screenSheet(ctx)],
    [
      element && onLook,
      () => h(ElementLook, Object.assign(lookPropsOf(ctx), { key: props.item.key + ":" + element.texture, element })),
    ],
  ];
  for (const [fits, build] of rows) {
    if (fits) return build();
  }
  return null;
}

function editorTabs(ctx) {
  if (ctx.byRows) return [];
  const rows = [
    [ctx.hasScreens, "screen", tr("Экран")],
    [true, "body", tr("Корпус")],
  ];
  return rows.filter((row) => row[0]).map((row) => ({ value: row[1], label: row[2] }));
}

function shownTab(ctx, tab) {
  if (!ctx.hasScreens || ctx.byRows) return "body";
  return tab === "body" ? "body" : "screen";
}

function toolLinksFor(ctx) {
  const { renderSeats, onTool } = ctx.props;
  const link = ITEM_LINKS[ctx.category];
  const usable = link && !(link[0] === "seats" && !renderSeats);
  return usable && onTool ? [linkEntry(link, onTool)] : [];
}

function linkList(links) {
  if (links.length === 0) return false;
  return h(ListGroup, { label: tr("Где ещё править") }, ...links.map((entry) => h(NavRow, navRowProps(entry))));
}

function modelCardOf(ctx, replaceable) {
  const { props } = ctx;
  const onSection = props.onSection;
  return h(ReplaceCard, {
    page: true,
    server: props.server,
    item: replaceable,
    entry: props.replace?.[replaceable.id],
    onNotice: props.onNotice,
    help: replaceHint(props.model.count),
    onPatch(entry, label) {
      const patch = {};
      patch[replaceable.id] = entry;
      return onSection("replace", patch, label);
    },
  });
}

function bodyOf(ctx, links, panelRole) {
  const { props } = ctx;
  const { model, part, onLook } = props;
  const kids = [];
  if (ctx.byRows && !part) kids.push(drawScreens(ctx));
  if (onLook) {
    const extra = { help: "", links, part, elements: ctx.elements };
    if (model.kind === "screen" && !ctx.hasScreens) extra.help = tr(HINTS.screenless);
    extra.screen = ctx.byRows && !part;
    kids.push(h(ItemLook, Object.assign(lookPropsOf(ctx), { key: props.item.key }, extra)));
  } else {
    kids.push(linkList(links));
  }
  const replaceable = arenaObjectReplaceable(props.replaceables, model.name);
  const renderSeats = props.renderSeats;
  const seatCategories = ["seats", "chairs"];
  const seats = renderSeats && seatCategories.includes(ctx.category) ? renderSeats() : null;
  kids.push(replaceable ? modelCardOf(ctx, replaceable) : seats);
  return h("div", { className: "arena-item-body", role: panelRole, "aria-label": tr("Корпус") }, ...kids);
}

function ArenaItemEditor(props) {
  useTr();
  const ctx = editorContext(props, useEditorHooks(props));
  const page = shortcutPage(ctx);
  if (page) return page;

  const [tab, setTab] = ctx.tabState;
  const children = [];
  const shown = shownTab(ctx, tab);
  const tabs = editorTabs(ctx);
  if (arenaItemIsGroup(props.server, props.item.key)) {
    children.push(h(SectionHeading, { help: tr(HINTS.group) }));
  }
  if (tabs.length > 1) {
    const bar = Object.assign({ label: tr("Что править"), size: "sm" }, { role: "tablist", options: tabs });
    children.push(h(SegmentedControl, Object.assign(bar, { value: shown, onChange: setTab })));
  }
  if (shown === "screen" && ctx.hasScreens) children.push(drawScreens(ctx));
  if (shown === "body") {
    children.push(bodyOf(ctx, toolLinksFor(ctx), tabs.length > 1 ? "tabpanel" : undefined));
  }
  return h("div", { className: "items-editor", "data-items-editor": ctx.category }, ...children);
}

// ---- «убрать / вернуть» ----

function removalResult(arg, sides, onRemove, onRestore) {
  const { alive, back } = sides;
  const result = { gone: arg.gone };
  result.canRemove = alive.length > 0;
  result.canRestore = back.length > 0;
  result.remove = function () {
    return onRemove(alive, noteFor("remove", alive.length));
  };
  result.restore = function () {
    return onRestore(back, noteFor("restore", back.length));
  };
  result.removeCount = alive.length;
  result.restoreCount = back.length;
  return result;
}

// Номера вещей делятся на ещё стоящие и уже убранные.
function splitByRemoved(keys, removedSet) {
  const sides = { alive: [], back: [] };
  keys.forEach((key) => sides[removedSet.has(key) ? "back" : "alive"].push(key));
  return sides;
}

function makeRemoval(server, removable, removedSet, onRemove, onRestore) {
  const refuse = (arg) => arg.model.shell || isStructure(arg.model) || !removable;
  return function removal(arg) {
    if (refuse(arg)) return { canRemove: false, canRestore: false };
    const sides = splitByRemoved(arenaObjectRemoval(server, arg.item.key, arg.scope), removedSet);
    return removalResult(arg, sides, onRemove, onRestore);
  };
}

function makeRemoveMany(server, removable, removedSet, onRemove) {
  if (!removable) return null;
  return function removeMany(keys) {
    const alive = keys.filter(function (key) {
      if (removedSet.has(key)) return false;
      const single = arenaObjectRemoval(server, key, "one");
      return single.some((entry) => entry === key);
    });
    if (!alive.length) return null;
    return {
      count: alive.length,
      remove() {
        return onRemove(alive, noteFor("remove", alive.length));
      },
    };
  };
}

function restoreRowOf(removedSet, onRestore) {
  const row = { id: "restore-all" };
  row.label = fill("Вернуть убранное ({0})", removedSet.size);
  row.onClick = function () {
    return onRestore ? onRestore(Array.from(removedSet), tr("Все предметы возвращены")) : undefined;
  };
  return row;
}

function massSection(p, section) {
  const { groups, setMass } = section;
  const attrs = { className: "ui-panel fx-section recolor-section", "aria-label": tr("Предметы") };
  attrs["data-arena-section"] = "items";
  const wiring = Object.assign({ groups, settings: p.screenSettings }, pick(p, ["onSection", "onNotice"]));
  wiring.onBack = function () {
    setMass(false);
  };
  return h("section", attrs, h(MassReplace, wiring));
}

function entryExtrasOf(p, removable, removedSet, setMass) {
  let massLink = null;
  if (p.screenSettings) {
    massLink = h(
      ListGroup,
      { label: tr("Заменить картинку у всех") },
      h(NavRow, {
        icon: h(ImageSquare),
        title: tr("Заменить картинку у всех"),
        onOpen() {
          setMass(true);
        },
      })
    );
  }
  let restoreRow = false;
  if (removable && removedSet.size) restoreRow = restoreRowOf(removedSet, p.onRestore);
  return (
    <>
      {massLink}
      <ActionRows actions={[restoreRow]} />
    </>
  );
}

// Слова панели про лист вещи: подписи и цвета листов, отдельные части.
function sheetWords(p, server) {
  const looks = p.looks;
  const asset = p.asset;
  return {
    partNote(key, piece) {
      const box = piece && piece.box;
      if (!box) return null;
      const group = arenaItemGroupOf(looks, key, { box });
      return partNoteOf(group);
    },
    elementNote(key, texture) {
      const group = arenaItemGroupOf(looks, key);
      return elementNoteOf(itemElementOf(group, texture));
    },
    elementsOf(key) {
      const group = arenaItemGroupOf(looks, key);
      return Array.from(arenaItemElements(asset, server, key), (entry) =>
        withElementColour(entry, itemElementOf(group, entry.texture))
      );
    },
  };
}

function renderSection(p, section, objects) {
  if (!objects) return null;
  return section.mass ? massSection(p, section) : itemsPanel(p, section, objects);
}

function itemsPanel(p, section, objects) {
  const server = p.server;
  const removable = Boolean(p.onRemove ? arenaObjectsRemovable(server) : false);

  const editorBase = Object.assign(pick(p, EDITOR_PROPS), { replaceables: section.replaceables });
  const panel = Object.assign(
    pick(p, PANEL_PROPS),
    { adapter: section.adapter, objects, entityBounds },
    {
      removal: makeRemoval(server, removable, section.removedSet, p.onRemove, p.onRestore),
      removeMany: makeRemoveMany(server, removable, section.removedSet, p.onRemove),
    },
    {
      renderEditor(context) {
        return h(ArenaItemEditor, Object.assign({}, editorBase, context));
      },
      renderMulti: p.onLook
        ? function (args) {
            const look = pick(p, ["looks", "removed", "onLook", "onNotice"]);
            return h(MultiLook, Object.assign(look, { adapter: section.lookAdapter, keys: args.keys }));
          }
        : null,
      entryExtras: entryExtrasOf(p, removable, section.removedSet, section.setMass),
    },
    sheetWords(p, server)
  );
  return h(ItemsPanel, panel);
}

function ItemsSection(given) {
  const p = withDefaults(given);
  useTr();
  return renderSection(p, useSectionView(p), arenaObjects(p.server));
}

export default ItemsSection;
