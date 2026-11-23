import {
  Alien,
  Anchor,
  Atom,
  Biohazard,
  Butterfly,
  Cat,
  Club,
  Crosshair,
  Crown,
  Diamond,
  Eye,
  Feather,
  Fire,
  FlowerLotus,
  GameController,
  Ghost,
  HandFist,
  Heart,
  Hexagon,
  Infinity as InfinityGlyph,
  Knife,
  Leaf,
  Lightning,
  MaskHappy,
  Moon,
  PawPrint,
  Peace,
  Planet,
  Radioactive,
  Robot,
  Rocket,
  ShootingStar,
  Skull,
  SmileyXEyes,
  Snowflake,
  Spade,
  Sparkle,
  Spiral,
  Star,
  Sun,
  Sword,
  Target,
  Trophy,
  YinYang,
} from "@phosphor-icons/react";
import { createRoot } from "react-dom/client";
import { trKey } from "./gun-copy.js";
import { flushSync } from "react-dom";
import { createElement } from "react";

// Каталог: группа, подпись группы и строки «id, значок, подпись».
// Порядок строк задаёт порядок показа в панели наклеек.
const CATALOG = [
  {
    group: "street",
    title: trKey("Улица"),
    rows: [
      ["skull", Skull, trKey("Череп")],
      ["crosshair", Crosshair, trKey("Прицел")],
      ["target", Target, trKey("Мишень")],
      ["spade", Spade, trKey("Пики")],
      ["club", Club, trKey("Трефы")],
      ["diamond", Diamond, trKey("Бриллиант")],
      ["knife", Knife, trKey("Нож")],
      ["fist", HandFist, trKey("Кулак")],
      ["biohazard", Biohazard, trKey("Биоугроза")],
      ["radioactive", Radioactive, trKey("Радиация")],
    ],
  },
  {
    group: "power",
    title: trKey("Сила"),
    rows: [
      ["crown", Crown, trKey("Корона")],
      ["fire", Fire, trKey("Огонь")],
      ["lightning", Lightning, trKey("Молния")],
      ["sword", Sword, trKey("Меч")],
      ["trophy", Trophy, trKey("Кубок")],
      ["star", Star, trKey("Звезда")],
      ["shooting-star", ShootingStar, trKey("Комета")],
      ["sparkle", Sparkle, trKey("Блеск")],
      ["hexagon", Hexagon, trKey("Шестигранник")],
      ["atom", Atom, trKey("Атом")],
      ["infinity", InfinityGlyph, trKey("Бесконечность")],
      ["anchor", Anchor, trKey("Якорь")],
    ],
  },
  {
    group: "nature",
    title: trKey("Природа"),
    rows: [
      ["heart", Heart, trKey("Сердце")],
      ["moon", Moon, trKey("Луна")],
      ["sun", Sun, trKey("Солнце")],
      ["snowflake", Snowflake, trKey("Снежинка")],
      ["lotus", FlowerLotus, trKey("Лотос")],
      ["leaf", Leaf, trKey("Лист")],
      ["feather", Feather, trKey("Перо")],
      ["butterfly", Butterfly, trKey("Бабочка")],
      ["paw", PawPrint, trKey("Лапа")],
      ["cat", Cat, trKey("Кот")],
      ["planet", Planet, trKey("Планета")],
      ["spiral", Spiral, trKey("Спираль")],
    ],
  },
  {
    group: "fun",
    title: trKey("Прикол"),
    rows: [
      ["eye", Eye, trKey("Глаз")],
      ["ghost", Ghost, trKey("Призрак")],
      ["alien", Alien, trKey("Пришелец")],
      ["robot", Robot, trKey("Робот")],
      ["rocket", Rocket, trKey("Ракета")],
      ["gamepad", GameController, trKey("Геймпад")],
      ["mask", MaskHappy, trKey("Маска")],
      ["dead", SmileyXEyes, trKey("Смайл")],
      ["peace", Peace, trKey("Знак мира")],
      ["yinyang", YinYang, trKey("Инь-ян")],
    ],
  },
];

const WEIGHT_ROWS = [
  ["fill", trKey("Заливка")],
  ["duotone", trKey("Два тона")],
  ["bold", trKey("Контур")],
];

export const EMBLEM_GROUPS = Object.freeze(
  CATALOG.map(({ group, title }) => ({ id: group, label: { ru: title } })),
);

export const EMBLEMS = Object.freeze(
  CATALOG.flatMap(({ group, rows }) =>
    rows.map(([id, Icon, ru]) => Object.freeze({ id, Icon, label: Object.freeze({ ru }), group })),
  ),
);

export const EMBLEM_WEIGHTS = Object.freeze(WEIGHT_ROWS.map(([id, ru]) => ({ id, label: { ru } })));

const SOURCE_HEAD = "emblem:";
const ICON_SIZE = 512;
const ICON_COLOUR = "#ffffff";
const XMLNS_ATTR = ' xmlns="http://www.w3.org/2000/svg"';

const emblemById = new Map(EMBLEMS.map((emblem) => [emblem.id, emblem]));
const knownWeights = new Set(EMBLEM_WEIGHTS.map(({ id }) => id));

// Память окна: что уже нарисовано, ключ — сам аргумент, как его передали.
const drawnMarkup = new Map();

export function emblemSource(id, weight = "fill") {
  return `${SOURCE_HEAD}${id}-${weight}`;
}

export function parseEmblemSource(source) {
  const line = source ? String(source) : "";
  if (!line.startsWith(SOURCE_HEAD)) return null;

  // Начертание — последнее «-слово», всё левее него — id (в id бывают дефисы).
  const tail = line.slice(SOURCE_HEAD.length);
  const cut = tail.lastIndexOf("-");
  if (cut < 1) return null;

  const weight = tail.slice(cut + 1);
  const emblem = emblemById.get(tail.slice(0, cut));
  return emblem && knownWeights.has(weight) ? { emblem, weight } : null;
}

export function emblemMarkup(source) {
  const remembered = drawnMarkup.get(source);
  if (remembered !== undefined) return remembered;
  if (typeof document === "undefined") return null;

  const parsed = parseEmblemSource(source);
  if (parsed === null) return null;

  const markup = acceptSvg(paintIcon(parsed));
  if (markup !== null) drawnMarkup.set(source, markup);
  return markup;
}

// Рисуем в оторванный узел своим корнем React и сразу забираем разметку.
// Из тела другого компонента flushSync ничего не нарисует — выйдет пустая строка.
function paintIcon({ emblem, weight }) {
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => {
    root.render(createElement(emblem.Icon, { weight, size: ICON_SIZE, color: ICON_COLOUR }));
  });
  const html = host.innerHTML;
  root.unmount();
  return html;
}

function opensSvgTag(html) {
  if (!html.startsWith("<svg")) return false;
  const next = html.charAt(4);
  return next === ">" || /\s/.test(next);
}

function acceptSvg(html) {
  if (!opensSvgTag(html)) return null;
  return html.includes("xmlns=") ? html : `<svg${XMLNS_ATTR}${html.slice(4)}`;
}
