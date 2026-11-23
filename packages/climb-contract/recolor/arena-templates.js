/*
 * Готовые шаблоны арены (ТЗ 12.10.2026): «сделай несколько красивых
 * шаблонов в стиле: валорант, майнкрафт, кс, дота, fortnite, просто какие-то
 * повседневные, новогодние, хэллоуинские. Прям редактируй всё… картинки на
 * PNG, и главное — чтобы люди могли их потом редактировать. И сделай для той
 * и той арены».
 *
 * Шаблон — тема: палитра, шрифт надписей и шесть своих PNG-картинок
 * (`ARENA_TEMPLATE_KINDS`, лежат рядом с приложением —
 * `public/assets/workshop/arenas/templates/<тема>-<вид>.png`, рисует их
 * `scripts/make-arena-template-art.mjs`). Шаблон кладётся в обычные поля
 * работы выбранного сервера — те же, что человек правит руками: пол —
 * своей плиткой, стены, потолок и фасад — цветом или узором, экраны,
 * эмблемы зала, плакаты и баннеры — картинками шаблона, надписи — своим
 * текстом (словами, не картинкой), кресла, подсветка и знаки выхода —
 * цветом, звезда GTA5RP — объёмной фигурой, у Majestic — аирдропы ящиком
 * шаблона, гонщик — фигурой, надписи обоих домиков — словами, эмблема на
 * фасаде. Поэтому после шаблона всё правится как обычно: заменить картинку,
 * поменять слова, цвет, выключить место.
 *
 * Картинки окно кладёт в своё хранилище (`saveHangarEmblem`) и передаёт сюда
 * их записи: `{ <вид>: { asset, name, width, height } }`. Свои модели
 * человека («Модели») шаблон не трогает. Чистые функции без DOM и Node.
 */

import { createArenasProject, normalizeArenasProject } from "./arenas.js";

/* Картинки шаблона: экран 16:9, баннер 1:2, эмблема (прозрачная), ящик (грань куба), фигура (прозрачная, в объём), плитка пола. */
export const ARENA_TEMPLATE_KINDS = Object.freeze(["screen", "banner", "logo", "crate", "figure", "floor"]);
export const ARENA_TEMPLATE_ROOT = "/assets/workshop/arenas/templates";

/** Адрес и имя файла картинки шаблона. */
export const arenaTemplatePicture = (id, kind) => ({ url: `${ARENA_TEMPLATE_ROOT}/${id}-${kind}.png`, name: `${id}-${kind}.png` });

export const ARENA_TEMPLATE_GROUPS = Object.freeze([
  Object.freeze({ id: "games", label: "Игры" }),
  Object.freeze({ id: "holidays", label: "Праздники" }),
  Object.freeze({ id: "daily", label: "На каждый день" }),
]);

/*
 * Поверхность шаблона: `{ colour, colour2?, effect?, direction? }` — свой
 * цвет (эффект общего словаря), `{ pattern, colours }` — узор отделки,
 * `{ tile: true, scale? }` — плитка-картинка шаблона (`floor`).
 */
const solid = (colour) => Object.freeze({ colour });
const blend = (colour, colour2, direction = "height") => Object.freeze({ colour, colour2, effect: "gradient", direction });
const pattern = (id, colours, scale = 100) => Object.freeze({ pattern: id, colours: Object.freeze(colours), scale });
const TILE = Object.freeze({ tile: true });

/*
 * Тема: `accent` — главный цвет (кресла, знаки выхода, подсветка), `light`
 * и `dark` — буквы и фон надписей, `board` — цвет таблички над домиком Cube
 * World, `title` — надпись над входом GTA5RP и на табличке домика Cube
 * World, `sign` — надпись на стенах домика Battle Royale (короткая: строка
 * там двухметровая), `font` — шрифт надписей, поверхности и звезда GTA5RP
 * (`stand`, `motion`).
 */
const theme = (input) => Object.freeze({ lights: input.accent, seats: input.accent, board: input.dark, ...input });

export const ARENA_TEMPLATES = Object.freeze([
  theme({
    id: "valorant",
    group: "games",
    label: "Валорант",
    description: "Красный на тёмно-синем, острые грани и тактический шрифт",
    accent: "#ff4655",
    light: "#ece8e1",
    dark: "#0f1923",
    title: "VALORANT ARENA",
    sign: "VALORANT",
    font: "wide",
    facade: solid("#1f2731"),
    floor: TILE,
    walls: solid("#1f2731"),
    ceiling: solid("#0f1923"),
    stand: "ring",
    motion: "spin",
  }),
  theme({
    id: "minecraft",
    group: "games",
    label: "Майнкрафт",
    description: "Пиксельная трава, каменные стены и ящики TNT",
    accent: "#5d9e3a",
    seats: "#7cbd4b",
    lights: "#7cbd4b",
    light: "#ffffff",
    dark: "#3b2a1a",
    board: "#6b4a2b",
    title: "MINECRAFT",
    sign: "CUBE WORLD",
    font: "mono",
    facade: pattern("digital", ["#5d9e3a", "#3f7a26", "#7cbd4b"], 160),
    floor: TILE,
    walls: pattern("bricks", ["#7f7f7f", "#5e5e5e", "#a5a5a5"]),
    ceiling: pattern("planks", ["#9c7a4b", "#6e5432", "#3a2a18"]),
    stand: "cube",
    motion: "bounce",
  }),
  theme({
    id: "cs",
    group: "games",
    label: "Counter-Strike",
    description: "Песок и бетон, оранжевые акценты, трафаретные надписи",
    accent: "#de9b35",
    light: "#f2e6cc",
    dark: "#1b1b1b",
    title: "COUNTER-STRIKE",
    sign: "DEFUSE",
    font: "stencil",
    facade: pattern("camo", ["#c9b78f", "#8a7a52", "#5f5640"], 140),
    floor: TILE,
    walls: pattern("concrete", ["#c9b78f", "#a8956d", "#6f6248"]),
    ceiling: solid("#2b2b2b"),
    stand: "pedestal",
    motion: "spin",
  }),
  theme({
    id: "dota",
    group: "games",
    label: "Дота",
    description: "Тёмное фэнтези: багровый, золото и замшелый камень",
    accent: "#a72714",
    lights: "#c8a35a",
    light: "#e8d3a0",
    dark: "#101418",
    title: "DOTA 2 ARENA",
    sign: "THE ANCIENT",
    font: "serif",
    facade: blend("#101418", "#a72714"),
    floor: TILE,
    walls: pattern("stone", ["#2a2f2a", "#151815", "#3e4a3a"]),
    ceiling: solid("#101418"),
    stand: "steps",
    motion: "levitate",
  }),
  theme({
    id: "fortnite",
    group: "games",
    label: "Фортнайт",
    description: "Яркие фиолетовый, синий и жёлтый, мультяшные ящики",
    accent: "#6b2fbf",
    lights: "#1e90ff",
    light: "#ffd400",
    dark: "#2a1458",
    title: "FORTNITE",
    sign: "VICTORY",
    font: "block",
    facade: blend("#6b2fbf", "#1e90ff", "along"),
    floor: TILE,
    walls: blend("#2a1458", "#6b2fbf"),
    ceiling: solid("#2a1458"),
    stand: "ring",
    motion: "bounce",
  }),
  theme({
    id: "newyear",
    group: "holidays",
    label: "Новый год",
    description: "Снег, ёлка, подарки и красно-золотые гирлянды",
    accent: "#c8102e",
    lights: "#f2c14e",
    light: "#ffffff",
    dark: "#0b1e3f",
    title: "С НОВЫМ ГОДОМ!",
    sign: "С НОВЫМ ГОДОМ",
    font: "script",
    facade: Object.freeze({ colour: "#c8102e", colour2: "#ffffff", effect: "line", direction: "along", width: 4 }),
    floor: TILE,
    walls: pattern("dots", ["#0b1e3f", "#ffffff", "#0b1e3f"], 60),
    ceiling: solid("#06122a"),
    stand: "steps",
    motion: "spin",
  }),
  theme({
    id: "halloween",
    group: "holidays",
    label: "Хэллоуин",
    description: "Тыквы, летучие мыши, луна и фиолетовый камень",
    accent: "#ff7518",
    lights: "#7cfc00",
    light: "#ff7518",
    dark: "#0d0d0d",
    title: "HALLOWEEN",
    sign: "HALLOWEEN",
    font: "serif",
    facade: blend("#0d0d0d", "#4b0082"),
    floor: TILE,
    walls: pattern("stone", ["#2a1838", "#120a18", "#4b2a5e"]),
    ceiling: solid("#0d0d0d"),
    stand: "pedestal",
    motion: "levitate",
  }),
  theme({
    id: "neon",
    group: "daily",
    label: "Неоновая ночь",
    description: "Ночной клуб: розовый и бирюзовый неон на чёрном",
    accent: "#ff2e97",
    lights: "#2ee6ff",
    light: "#2ee6ff",
    dark: "#07070c",
    title: "NEON NIGHT",
    sign: "NEON NIGHT",
    font: "modern",
    facade: blend("#ff2e97", "#2ee6ff", "along"),
    floor: TILE,
    walls: blend("#07070c", "#7b2cff"),
    ceiling: solid("#07070c"),
    stand: "ring",
    motion: "spin",
  }),
  theme({
    id: "sport",
    group: "daily",
    label: "Спортивная классика",
    description: "Синий, белый и красный, паркет как на баскетбольной площадке",
    accent: "#d7263d",
    seats: "#1f4e9e",
    lights: "#ffffff",
    light: "#ffffff",
    dark: "#1f4e9e",
    title: "ARENA SPORT",
    sign: "ARENA SPORT",
    font: "block",
    facade: solid("#1f4e9e"),
    floor: TILE,
    walls: solid("#1f4e9e"),
    ceiling: solid("#14213d"),
    stand: "pedestal",
    motion: "bounce",
  }),
  theme({
    id: "luxe",
    group: "daily",
    label: "Чёрное золото",
    description: "Чёрный мрамор с золотом, корона и тонкие линии ар-деко",
    accent: "#d4af37",
    light: "#f3e5ab",
    dark: "#0b0b0d",
    title: "GOLD CLUB",
    sign: "GOLD CLUB",
    font: "serif",
    facade: solid("#0b0b0d"),
    floor: TILE,
    walls: pattern("marble", ["#141416", "#d4af37", "#2a2a2e"], 140),
    ceiling: solid("#0b0b0d"),
    stand: "steps",
    motion: "spin",
  }),
]);

/** Шаблон по ключу или `null`. */
export const arenaTemplate = (id) => ARENA_TEMPLATES.find((item) => item.id === id) || null;

/* ------------------------------------------------------------------ *
 * Шаблон → поля работы
 * ------------------------------------------------------------------ */

const image = (picture) => ({ asset: picture.asset, name: picture.name, width: picture.width, height: picture.height });

function surface(spec, pictures) {
  if (spec.tile) return { mode: "image", image: { ...image(pictures.floor), fit: "tile", scale: spec.scale ?? 100, tint: "#ffffff", strength: 0 }, shade: 60 };
  if (spec.pattern) return { mode: "pattern", pattern: { id: spec.pattern, colours: [...spec.colours], scale: spec.scale }, shade: 60 };
  return {
    mode: "colour",
    look: { mode: spec.effect || "solid", colour: spec.colour, colour2: spec.colour2 || spec.colour, direction: spec.direction || "height", width: spec.width ?? 1, shift: 0 },
  };
}

/* Свой текст надписи шаблона: слова, шрифт и цвета темы. */
const words = (template, value) => ({ value, font: template.font, colour: template.light, outline: "dark" });

/* Картинка в местах раздела: экраны и плакаты — заполнить, эмблемы — вписать на прозрачном фоне. */
const fill = (template, picture) => ({ mode: "image", image: image(picture), transform: { fit: "cover", background: "colour", backgroundColour: template.dark } });
const emblem = (picture, background = "clear") => ({ mode: "image", image: image(picture), transform: { fit: "contain", background } });

/* Своя картинка вместо модели сервера (Majestic): ящик — кубом, фигура — объёмом. */
const replacement = (picture, shape, scale = 1) => ({ mode: "model", model: { asset: picture.asset, name: picture.name, shape, width: picture.width, height: picture.height }, scale, turn: 0 });

function serverSettings(template, server, pictures) {
  const common = {
    facade: surface(template.facade, pictures),
    floor: surface(template.floor, pictures),
    walls: surface(template.walls, pictures),
    ceiling: surface(template.ceiling, pictures),
    screens: fill(template, pictures.screen),
    logos: emblem(pictures.logo),
    seats: { mode: "colour", colour: template.seats },
    /* Эмблема шаблона — плашкой на фасаде, на месте эмблемы по умолчанию. */
    emblems: [{ kind: "image", ...image(pictures.logo), size: 12, opacity: 100 }],
  };
  if (server === "gta5rp")
    return {
      ...common,
      posters: fill(template, pictures.banner),
      outBanners: fill(template, pictures.banner),
      outLogos: emblem(pictures.logo, "keep"),
      mazeSign: { mode: "text", text: words(template, template.title), transform: { fit: "contain", background: "colour", backgroundColour: template.dark } },
      exits: { mode: "colour", colour: template.accent },
      star: { mode: "image", image: image(pictures.figure), stand: template.stand, animation: template.motion, size: 4.5, speed: 1, height: 0.6, depth: 14 },
    };
  return {
    ...common,
    lights: { mode: "colour", colour: template.lights },
    replace: {
      airdrop: replacement(pictures.crate, "box", 0.85),
      racer: replacement(pictures.figure, "solid"),
      /* Домики — на месте, со словами шаблона: табличка над Cube World и строки стенда Battle Royale. */
      house: { mode: "standard", sign: { mode: "text", text: words(template, template.title), size: 1, glow: 0, background: template.board } },
      stand: { mode: "standard", sign: { mode: "text", text: words(template, template.sign), size: 1, glow: 60 } },
    },
  };
}

/**
 * Работа с шаблоном у выбранного сервера: облик сервера — с нуля по
 * шаблону (что шаблон не задаёт — «Стандарт»), свои модели человека
 * («Модели») остаются, другой сервер и имя работы не трогаются.
 * `pictures` — записи картинок шаблона в хранилище окна по видам. Без
 * нужной картинки — отказ словами.
 */
export function applyArenaTemplate(input, id, pictures) {
  const template = arenaTemplate(id);
  if (!template) throw new Error("Такого шаблона арены нет.");
  for (const kind of ARENA_TEMPLATE_KINDS) if (!pictures?.[kind]?.asset) throw new Error(`Картинка шаблона «${template.label}» не загрузилась — нажмите на шаблон ещё раз.`);
  const project = normalizeArenasProject(input);
  const server = project.server;
  const base = createArenasProject()[server];
  return normalizeArenasProject({
    ...project,
    [server]: { ...base, ...serverSettings(template, server, pictures), models: project[server].models },
  });
}
