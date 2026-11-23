// Что окно отдаёт наружу после хуков: сводка для панели справа, свойства поверх кадра,
// метка «занято» и вход кадра сцены. Всё берётся из сводки win (см. wiring.js).
import { tr } from "../../../../locales/ui.js";
import { pull } from "./bindings.js";

// Классы оболочки редактора; порядок ключей совпадает с порядком свойств оболочки
export const SHELL_CLASSES = Object.fromEntries(
  [
    ["className", "shell"],
    ["headerClassName", "topbar"],
    ["copyClassName", "title"],
    ["actionsClassName", "actions"],
  ].map(([prop, part]) => [prop, "wmc-" + part]),
);

// Одна сводка для панели справа и её шапки
const SHEET_BAGS = [
  "core", "board", "flow", "picks", "pictures",
  "placing", "outbound", "source", "raster", "sceneKit",
];
const SHEET_OWN = [
  "apply",
  "onSection",
  "notify",
  "assetUrls",
  "fonts",
  "icons",
  ["frame", (win) => win.view.frame],
  ["tools", (win) => win.rail.tools],
  ["railTool", (win) => win.rail.rail.tool],
  ["onLayersMenu", (win) => win.menu.onLayersMenu],
  ["onFocus", (win) => win.picks.onFocus],
];

export const sheetOf = (win) =>
  Object.assign({}, ...SHEET_BAGS.map((bag) => win[bag]), pull(win, SHEET_OWN));

// Кнопки полоски выбора работают с выделением и проектом той отрисовки, в которой полоска показана
const barActionsOf = (rendered) => ({
  group: rendered.groupPicked,
  ungroup: rendered.ungroupPicked,
  remove: () => rendered.removeTargets(),
  clear: rendered.clearPicked,
});

// Всё, что кадр рисует поверх сцены
export const overlayInput = (win) => ({
  ...pull(win, ["icons", "assetUrls", "loader", "source", ["tool", (w) => w.core.tool]]),
  work: win.config.blipIcons,
  bar: win.picks.bar,
  actions: barActionsOf(win.picks.rendered),
});

// Метка «занято» на кадре
export const busyInput = (win) => ({
  ...pull(win, ["source", "raster", "settling", "sceneKit"]),
  words: { reading: tr("Читаю карту из игры…"), labels: tr("Готовим подписи…") },
});

// Что панель отдаёт кадру сцены
const STAGE_PARTS = [
  "core", "config", "source", "sceneKit", "view", "text", "placing",
  "picks", "pictures", "board", "menu", "flow", "apply", "busy", "overlay",
];
export const stageInput = (win) => pull(win, STAGE_PARTS);

// Свойства оболочки редактора до guideKey: классы, шапка, колонка инструментов, панель справа.
// Порядок ключей — порядок свойств оболочки; panelHead считает главный файл.
export function chromeOf(win, panelHead) {
  const { props, rail } = win;
  const chrome = { ...SHELL_CLASSES };
  chrome.title = tr("Мастерская большой карты");
  chrome.status = win.notice || (props.dirty ? tr("Есть несохранённые изменения") : "");
  chrome.backLabel = tr("Назад в мастерскую");
  chrome.onBack = props.onCancel;
  Object.assign(chrome, pull(rail.rail, ["tools", "tool", "onTool"]));
  chrome.toolShortcuts = false;
  chrome.panelHead = panelHead;
  chrome.guide = rail.guide;
  return chrome;
}

// Меню объекта: место, заголовок и пункты, выбор и закрытие
export function menuProps(menu) {
  const { menuRequest, menuModel } = menu;
  return {
    x: menuRequest.x,
    y: menuRequest.y,
    title: menuModel.title,
    options: menuModel.options,
    onSelect: menu.onSelectItem,
    onClose: menu.closeMenu,
  };
}

// Кнопки шапки: отмена и возврат, меню «Ещё». «Применить» (apply={…}) ставит сама оболочка в разметке.
export function actionProps(win) {
  const { props, outbound } = win;
  return {
    ...pull(props, ["onUndo", "canUndo", "onRedo", "canRedo"]),
    more: outbound.moreItems,
    onMore: outbound.onMore,
  };
}

// Окно горячих клавиш
export function dialogProps(keys, rail) {
  return {
    open: keys.shortcutsOpen,
    onClose: () => keys.setShortcutsOpen(false),
    kicker: tr("Мастерская большой карты"),
    groups: rail.shortcutGroups,
  };
}
