import { tr } from "../../locales/ui.js";

/** Части каркаса редактора и их селекторы (порядок ключей важен). */
export const PARTS = Object.freeze({
  ...Object.fromEntries([
    ["tabs", ".ui-editor-tabs"],
    ["tools", ".ui-editor-tools"],
    ["canvas", ".ui-editor-canvas"],
    ["rail", ".ui-editor-rail"],
    ["inspector", ".ui-editor-panel, .ui-editor-inspector"],
    ["actions", ".ui-editor-actions"],
  ]),
});

// Тексты общего прохода в порядке обхода: [id, заголовок, описание].
// Через tr они проходят только в момент вызова, не при загрузке модуля.
const TOUR_COPY = [
  ["tabs", "Виды", "Переключайте, что настраиваете. Правки каждого вида сохраняются."],
  ["tools", "Инструменты", "Выберите, чем править. Справа сразу появятся его настройки."],
  ["rail", "Выбор", "Здесь — из чего выбирать. Нажмите нужное, кадр покажет его."],
  ["canvas", "Кадр", "Здесь сразу видно, что получится. Любая правка меняет кадр."],
  ["inspector", "Настройки", "Меняйте значения — кадр обновится сразу."],
  ["actions", "Применить", "Когда всё нравится — применяйте. «Отмена» вернёт как было."],
];

const TOOL_TIP_TITLE = "Инструмент";

const LABEL_OPEN = '[aria-label="';

// Имя части превращается в её селектор, всё остальное остаётся как есть.
const resolvePart = (item) => PARTS[item] ?? item;

// Подписи вида [aria-label="Текст"] идут через tr, остальная строка не меняется.
function translateLabels(selector) {
  let out = "";
  let copied = 0;
  let open = selector.indexOf(LABEL_OPEN);
  while (open !== -1) {
    const textStart = open + LABEL_OPEN.length;
    const quote = selector.indexOf('"', textStart);
    const complete = quote > textStart && selector[quote + 1] === "]";
    if (complete) {
      out += selector.slice(copied, textStart) + tr(selector.slice(textStart, quote));
      copied = quote;
    }
    open = selector.indexOf(LABEL_OPEN, complete ? quote : textStart);
  }
  return out + selector.slice(copied);
}

export function selectorFor(target) {
  const joined = Array.isArray(target) ? target.map(resolvePart).join(", ") : resolvePart(target);
  if (typeof joined !== "string") {
    throw new TypeError("Цель шага должна быть строкой или массивом");
  }
  return translateLabels(joined);
}

export function buildTourSteps({
  rail = false,
  tabs = false,
  tools = false,
  canvas = true,
  actions = false,
  guide = [],
  hint = null,
  inspector = false,
  tool = null,
} = {}) {
  const enabled = { tabs, tools, rail, canvas, inspector, actions };
  const own = {
    canvas: { text: hint?.hint },
    inspector: { title: tool?.label, text: tool?.hint },
  };

  return TOUR_COPY.filter(([id]) => enabled[id]).map(([id, title, text]) => {
    const custom = own[id] ?? {};
    const frame = id === "canvas";
    return {
      id,
      target: id,
      ...(frame && { placement: "inside" }),
      title: custom.title || tr(title),
      text: custom.text || tr(text),
      ...(frame && { keys: guide }),
    };
  });
}

export function buildToolTip(tool) {
  const { id, label, hint } = tool || {};
  if (!id || !hint) return [];
  return [
    {
      id: `tool:${id}`,
      target: "inspector",
      title: label || tr(TOOL_TIP_TITLE),
      text: hint,
    },
  ];
}
