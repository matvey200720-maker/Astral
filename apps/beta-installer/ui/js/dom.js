// Узлы окна установщика строятся вручную: сборщика нет, папка ui/ вшивается в exe как есть
// (apps/beta-installer/BRIDGE.md, §1), поэтому разметка — вызовы h(), а значки живут здесь же.

const SVG_NS = "http://www.w3.org/2000/svg";

// Рисунки значков: сетка 24×24, контур, цвет текста (набор Lucide). Значок — одна строка:
// части разделены «|»; «r:x,y,w,h,rx» — прямоугольник, «c:cx,cy,r» — круг, всё прочее — путь.
const GLYPHS = {
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18|m6 6 12 12",
  minus: "M5 12h14",
  chevron: "m6 9 6 6 6-6",
  copy: "r:9,9,13,13,2|M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  paste: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2|r:8,2,8,4,1",
  alert: "c:12,12,10|M12 8v4|M12 16h.01",
  warning: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3|M12 9v4|M12 17h.01",
  info: "c:12,12,10|M12 16v-4|M12 8h.01",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|m7 10 5 5 5-5|M12 15V3",
  package:
    "m7.5 4.27 9 5.15|M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z|m3.3 7 8.7 5 8.7-5|M12 22V12",
  layout: "r:3,3,18,18,2|M3 9h18|M9 21V9",
  external: "M15 3h6v6|M10 14 21 3|M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  refresh:
    "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8|M21 3v5h-5|M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16|M8 16H3v5",
  trash: "M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2|M10 11v6|M14 11v6",
  play: "M6 4l14 8-14 8z",
  arrow: "M5 12h14|m12 5 7 7-7 7",
  folder:
    "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  log: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z|M14 2v4a2 2 0 0 0 2 2h4|M10 9H8|M16 13H8|M16 17H8",
  shield:
    "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
};

export const ICON_NAMES = Object.freeze([...Object.keys(GLYPHS)]);

// Поля узла, которые пишутся свойством, а не атрибутом (в разметке их нет, кроме булевых).
const NODE_FIELD = /^(?:value|checked|disabled|hidden|readOnly|textContent)$/;

// Условия пишутся прямо в аргументах (null, false, undefined пропускаются), поэтому экраны не ветвят построение
// и разметка читается как одно выражение.
const isBlank = (value) => value === null || value === undefined || value === false;

// Правила разбора свойства: «условие → действие», побеждает первое подошедшее.
const PROP_RULES = [
  [
    (key) => key === "class",
    (node, _key, value) => {
      node.className = value;
    },
  ],
  [(key) => key === "dataset", (node, _key, value) => Object.assign(node.dataset, value)],
  [
    (key, value) => key.startsWith("on") && typeof value === "function",
    (node, key, value) => node.addEventListener(key.replace(/^on/, "").toLowerCase(), value),
  ],
  [
    (key) => NODE_FIELD.test(key),
    (node, key, value) => {
      node[key] = value;
    },
  ],
  [() => true, (node, key, value) => node.setAttribute(key, String(value === true ? "" : value))],
];

function applyProps(node, props) {
  Object.entries(props || {})
    .filter(([, value]) => !isBlank(value))
    .forEach(([key, value]) => PROP_RULES.find(([matches]) => matches(key, value))[1](node, key, value));
  return node;
}

// Дети: вложенные массивы раскрываются на любую глубину, дыры и «пустое» выпадают, остальное становится узлом.
function* leaves(list) {
  for (const entry of list) {
    if (Array.isArray(entry)) yield* leaves(entry);
    else if (!isBlank(entry)) yield !(entry instanceof Node) ? document.createTextNode(String(entry)) : entry;
  }
}

export function append(node, children) {
  if (!Array.isArray(children)) throw new TypeError("append: children must be an array");
  const nodes = [...leaves(children)];
  if (nodes.length === 0) return node;
  node.append(...nodes);
  return node;
}

export const h = (tag, props, ...children) => append(applyProps(document.createElement(tag), props), children);

export const clear = (node) => {
  for (let first = node.firstChild; first; first = node.firstChild) first.remove();
  return node;
};

export const svgNode = (tag, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
};

const SHAPE_KINDS = {
  r: ["rect", ["x", "y", "width", "height", "rx"]],
  c: ["circle", ["cx", "cy", "r"]],
};

function drawPart(piece) {
  const shape = /^([rc]):(.+)$/.exec(piece);
  if (!shape) return svgNode("path", { d: piece });
  const [tag, names] = SHAPE_KINDS[shape[1]];
  return svgNode(tag, Object.fromEntries(shape[2].split(",").map((num, at) => [names[at], num])));
}

// Имена из прототипа объекта (constructor, toString…) здесь «находятся» и не split-ятся: это TypeError,
// он сохранён как есть (боевые имена — литералы, достичь его можно только ошибкой вызывающего).
const partsOf = (recipe) => (recipe === undefined ? [] : recipe.split("|").map(drawPart));

export const icon = (name, { strokeWidth = 2 } = {}) => {
  const frame = svgNode("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": strokeWidth,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  frame.append(...partsOf(GLYPHS[name]));
  return frame;
};
