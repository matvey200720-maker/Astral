import { createElement } from "react";
import { setMapGroupVisible, resetMapGroup, removeMapGroup, ownSetOfGroup, mapGroupFactory, mapGroupPristine, mapGroups } from "@modovik/vector-map";
import { TextAa, Polygon, FloppyDisk, ArrowsOut, EyeSlash, Eye, ArrowCounterClockwise, Trash, DotsThree } from "../../../ui/icons.jsx";
import Switch from "../../../ui/Switch.jsx";
import MenuButton from "../../../ui/MenuButton.jsx";
import { counted } from "../../../../plural.js";
import { tr } from "../../../../locales/ui.js";
import { ownMapPresets } from "./own-store.js";
import { saveOfPage } from "./MapOwnSets.jsx";
import { mapText, trForms, setTitle } from "./map-copy.js";
import { SET_WORDS, ITEM_WORDS, SECTION_OF, setOfPage } from "./MapSetsTool.jsx";

const h = createElement;

// Слова инструментов; переводятся в момент вызова, не при загрузке модуля.
const TOOLS = new Map([
  [
    "labels",
    {
      label: "Подписи",
      back: "Назад к подписям",
      Icon: TextAa,
      bare: "Наборы подписей, шрифт и цвет",
      toggle: "Подписи на карте",
      on: "Подписи показаны",
      off: "Подписи скрыты",
    },
  ],
  [
    "zones",
    {
      label: "Зоны",
      back: "Назад к зонам",
      Icon: Polygon,
      bare: "Территории, районы, заливка и граница",
      toggle: "Зоны на карте",
      on: "Зоны показаны",
      off: "Зоны скрыты",
    },
  ],
]);

const HOME_PAGE = "home";

// ---- страница сохранения ----
function savePage(ctx, wanted) {
  const known = ctx.groups.map((entry) => entry.id).includes(wanted);
  const target = wanted && known ? wanted : null;
  const go = (page) => () => ctx.onPage && ctx.onPage(page);
  const back = target
    ? { label: tr("Назад к набору"), onClick: go("set:" + target) }
    : { label: tr(ctx.tool.back), onClick: go(HOME_PAGE) };
  return {
    label: tr("Свой набор"),
    note: tr("Сохранится в лаунчере — для любой карты"),
    icon: h(FloppyDisk),
    back,
  };
}

// ---- главная страница ----
function homeNote({ tool, part, section, groups }) {
  if (groups.length === 0) return tr(tool.bare);
  const sets = counted(groups.length, trForms(SET_WORDS));
  const items = part.items;
  const own = items.filter((item) => !item.mesh);
  if (items.length > 0 && own.length === 0) return sets;
  return [sets, counted(own.length, trForms(ITEM_WORDS[section]))].join(" · ");
}

function homeToggle({ tool, part, section, groups, onSection }) {
  if (groups.length === 0) return null;
  const flip = (enabled) =>
    onSection({ [section]: { ...part, enabled } }, tr(enabled ? tool.on : tool.off), `${section}.enabled`);
  return h(Switch, { checked: part.enabled, label: tr(tool.toggle), onChange: flip });
}

function homePage(ctx) {
  const note = homeNote(ctx);
  const icon = h(ctx.tool.Icon);
  return { label: ctx.label, note, icon, actions: homeToggle(ctx) };
}

// ---- страница набора ----
function menuOptions({ group, mine, canReset }) {
  const rows = [
    ["show", "Показать на карте", ArrowsOut],
    ["visible", group.visible ? "Скрыть набор" : "Показать набор", group.visible ? EyeSlash : Eye],
    null,
    ["save", mine ? "Сохранить правки в свой набор…" : "Сохранить как свой набор…", FloppyDisk],
    [
      "reset",
      mine ? "Вернуть как сохранено" : "Сбросить до заводских",
      ArrowCounterClockwise,
      { disabled: !canReset },
    ],
    ["remove", "Убрать с карты", Trash, { danger: true }],
  ];
  return rows.map((row) => {
    if (row === null) return { separator: true };
    const [value, text, Icon, flags] = row;
    return { value, label: tr(text), icon: h(Icon), ...flags };
  });
}

function menuActions(ctx, view) {
  const { config, section, onConfig, onPage, onFocusSet } = ctx;
  const { group, title, lookup, mine } = view;
  const say = (text) => mapText(text, { title });
  return {
    show: () => onFocusSet && onFocusSet(section, group.id),
    visible: () => {
      const next = setMapGroupVisible(config, section, group.id, !group.visible);
      onConfig(next, say(group.visible ? "Набор «{title}» скрыт" : "Набор «{title}» показан"));
    },
    save: () => onPage && onPage("save:" + group.id),
    reset: () => {
      const next = resetMapGroup(config, section, group.id, lookup);
      onConfig(next, say(mine ? "Набор «{title}» — как сохранён" : "Набор «{title}» — как из каталога"));
    },
    remove: () => {
      onPage?.(HOME_PAGE);
      onConfig(removeMapGroup(config, section, group.id), say("Набор «{title}» убран — Ctrl+Z вернёт"));
    },
  };
}

function setPage(ctx, group) {
  const { section, config, tool, names, part } = ctx;
  const title = setTitle(group.title);
  const donor = part.items.some((item) => item.mesh && item.group === group.id);
  const own = ownMapPresets().sets;
  const stored = own.map((entry) => "my-" + entry.id);
  const mine = Boolean(ownSetOfGroup(group.id)) && stored.includes(group.id);
  const lookup = { names, own };
  const factory = mapGroupFactory(section, group.id, lookup);
  const pristine = factory ? mapGroupPristine(config, section, group.id, lookup) : true;

  const count = donor ? tr("Подписи карты автора, один в один") : counted(group.count, trForms(ITEM_WORDS[section]));
  const actions = menuActions(ctx, { group, title, lookup, mine });

  return {
    label: h("span", { "data-audit-ignore": "caps" }, title),
    note: group.visible ? count : count + tr(" · скрыт"),
    back: { label: tr(tool.back), onClick: () => ctx.onPage && ctx.onPage(HOME_PAGE) },
    actions: h(MenuButton, {
      ariaLabel: mapText("Набор «{title}»: ещё", { title }),
      variant: "ghost",
      align: "end",
      trailing: null,
      icon: h(DotsThree),
      options: menuOptions({ group, mine, canReset: Boolean(factory) && !pristine }),
      onSelect: (value) => actions[value](),
    }),
  };
}

export function setsToolHead(kind, { config, ...rest }) {
  const tool = TOOLS.get(kind);
  const label = tr(tool.label);
  const section = SECTION_OF[kind];
  const part = config[section];
  const groups = mapGroups(config, section);
  const ctx = { ...rest, config, tool, label, section, part, groups };

  const savePageRef = saveOfPage(rest.page);
  if (savePageRef !== null && groups.length > 0) return savePage(ctx, savePageRef.group);

  const setId = setOfPage(rest.page);
  const opened = setId === null ? [] : groups.filter((entry) => entry.id === setId);
  return opened.length > 0 ? setPage(ctx, opened[0]) : homePage(ctx);
}
