import { BODY_ROLES, materialRole } from "./parts.js";
import {
  addSticker,
  createFillLayer,
  createPatternLayer,
  createShadeLayer,
  createSticker,
  createWear,
} from "./project.js";

const freeze = Object.freeze;

const STICKER_PREFIX = "Шаблон · ";

// Список классов, общий для шаблонов «на любой ствол».
const ALL_FAMILIES = freeze(["pistol", "rifle", "smg", "shotgun", "sniper", "machinegun"]);

// Посадка: эталон, под который рисовались шаблоны (револьвер).
export const FIT_REFERENCE = freeze({ density: 3.99, angle: -2.8 });
const COHERENCE_MIN = 0.6;
const PATTERN_SCALE_RANGE = freeze({ min: 10, max: 400 });

// Слои описаны снизу вверх: от фона к узору. Цвет слоя — номер цвета палитры 0–3 или готовая строка.
// Расцветка — [id, метка, цвет 0, цвет 1, цвет 2, цвет 3].

// Шаблоны на любой ствол (Ш1–Ш18)
const GENERAL_DEFS = [
  {
    id: "factory",
    ru: "Как в игре",
    hint: "Заводская покраска без правок",
    wear: 0,
    chromas: [
      ["stock", "Заводской", "#2b2d31", "#44474d", "#6b6f76", "#15171a"],
    ],
    body: [],
    mag: [],
  },
  {
    id: "gold",
    ru: "Золото",
    hint: "Полированный металл, как золотой камуфляж",
    wear: 0,
    chromas: [
      ["gold", "Золото", "#c9962b", "#f3d27a", "#8a5a12", "#fff3c4"],
      ["platinum", "Платина", "#9ea4ab", "#e6e9ec", "#5d6268", "#ffffff"],
      ["rose", "Розовое", "#c47a6a", "#f2c1b0", "#7f3f33", "#fff0ea"],
      ["obsidian", "Чёрное", "#17140f", "#c9962b", "#050403", "#f3d27a"],
    ],
    body: [
      { kind: "fill", colour: 0, blend: "color", name: "Тон металла" },
      { kind: "pattern", pattern: "brushed", colours: [0, 1, 2, 3], blend: "overlay", opacity: 70, name: "Шлифовка" },
    ],
    mag: [
      { kind: "fill", colour: 0, blend: "color", name: "Тон металла" },
    ],
  },
  {
    id: "carbon",
    ru: "Карбон",
    hint: "Плетёное углеволокно под лаком",
    wear: 0,
    chromas: [
      ["black", "Чёрный", "#0e0f11", "#25272b", "#3b3e44", "#70757d"],
      ["red", "Кевлар", "#1a0706", "#5c1510", "#8f241a", "#ff6b57"],
      ["blue", "Синий", "#060b16", "#122a55", "#1f4a8f", "#6ea8ff"],
    ],
    body: [
      { kind: "pattern", pattern: "carbon", colours: [0, 1, 2, 3], name: "Карбон" },
    ],
    mag: [
      { kind: "pattern", pattern: "carbon", colours: [0, 1, 2, 3], name: "Карбон", scale: 80 },
    ],
  },
  {
    id: "woodland",
    ru: "Лес",
    hint: "Армейский камуфляж с потёртостями",
    wear: 28,
    chromas: [
      ["forest", "Лес", "#27301f", "#4b5b36", "#7a6a45", "#141712"],
      ["desert", "Пустыня", "#b89b6e", "#8c7350", "#d9c39a", "#5e4b33"],
      ["winter", "Зима", "#dfe3e6", "#9aa3aa", "#5e666d", "#ffffff"],
      ["night", "Ночь", "#12151c", "#232a38", "#394257", "#07080b"],
    ],
    body: [
      { kind: "pattern", pattern: "woodland", colours: [0, 1, 2, 3], name: "Камуфляж" },
    ],
    mag: [
      { kind: "pattern", pattern: "woodland", colours: [0, 1, 2, 3], name: "Камуфляж", seed: 311 },
    ],
  },
  {
    id: "digital",
    ru: "Пиксель",
    hint: "Цифровой камуфляж",
    wear: 12,
    chromas: [
      ["urban", "Город", "#5a5e63", "#8c9094", "#c4c7ca", "#2b2e31"],
      ["jungle", "Джунгли", "#2e3a24", "#556b3a", "#8a9a5b", "#1a2014"],
      ["arctic", "Арктика", "#e8eef2", "#b8c7d3", "#7c93a6", "#ffffff"],
      ["neon", "Неон", "#0d0d14", "#ff2e97", "#2ef2ff", "#fff75e"],
    ],
    body: [
      { kind: "pattern", pattern: "digital", colours: [0, 1, 2, 3], name: "Пиксель" },
    ],
    mag: [
      { kind: "pattern", pattern: "digital", colours: [0, 1, 2, 3], name: "Пиксель", seed: 77 },
    ],
  },
  {
    id: "tiger",
    ru: "Тигр",
    hint: "Рваные полосы и тёплый металл",
    wear: 8,
    chromas: [
      ["amber", "Янтарь", "#c98a2b", "#1b1612", "#e2b467", "#3a2a17"],
      ["white", "Белый", "#e9e7e2", "#1a1a1a", "#ffffff", "#3a3a3a"],
      ["blood", "Кровь", "#7a0d0d", "#0f0808", "#b31b1b", "#2a0a0a"],
    ],
    body: [
      { kind: "pattern", pattern: "tiger", colours: [0, 1, 2, 3], name: "Полосы", scale: 120 },
    ],
    mag: [
      { kind: "fill", colour: 1, name: "Магазин патронов" },
    ],
  },
  {
    id: "prime",
    ru: "Прайм",
    hint: "Белый корпус и золотые линии",
    wear: 0,
    chromas: [
      ["white", "Белое золото", "#eceae4", "#c9962b", "#9a9890", "#fff3c4"],
      ["black", "Чёрное золото", "#151515", "#c9962b", "#2b2b2b", "#f3d27a"],
      ["azure", "Лазурь", "#e7eef5", "#2f7de1", "#8fa3b8", "#bfe0ff"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Основа" },
      { kind: "pattern", pattern: "stripes", colours: [0, 1, 2, 3], blend: "source-over", opacity: 85, name: "Линии", scale: 160 },
    ],
    mag: [
      { kind: "fill", colour: 1, name: "Магазин патронов" },
    ],
  },
  {
    id: "neon",
    ru: "Неон",
    hint: "Кислотный градиент и светящиеся соты",
    wear: 0,
    chromas: [
      ["pop", "Поп", "#7b2ff7", "#f107a3", "#00d4ff", "#0b0b12"],
      ["mint", "Мята", "#00c9a7", "#845ec2", "#c4fcef", "#0b1412"],
      ["sunset", "Закат", "#ff6a00", "#ee0979", "#ffd200", "#140a0a"],
    ],
    body: [
      { kind: "pattern", pattern: "gradient", colours: [0, 1, 2, 3], name: "Градиент" },
      { kind: "pattern", pattern: "hex", colours: [3, 1, 2, 3], blend: "screen", opacity: 55, name: "Соты", scale: 70, glow: 70 },
    ],
    mag: [
      { kind: "pattern", pattern: "gradient", colours: [1, 2, 0, 3], name: "Градиент" },
    ],
  },
  {
    id: "flag",
    ru: "Флаг",
    hint: "Полотнище вдоль ствола: волна, складки и отсвет",
    wear: 0,
    chromas: [
      ["russia", "Россия", "#ffffff", "#0039a6", "#d52b1e", "#15161a"],
      ["night", "Ночь", "#d9dde6", "#1f3a8a", "#9b1c1c", "#07080b"],
    ],
    body: [
      { kind: "pattern", pattern: "flag", colours: [0, 1, 2, 3], name: "Полотнище", scale: 170 },
      { kind: "pattern", pattern: "gradient", colours: [3, 0, 3, 3], blend: "screen", opacity: 30, name: "Перелив", glow: 35 },
    ],
    mag: [
      { kind: "pattern", pattern: "flag", colours: [0, 1, 2, 3], name: "Полотнище", scale: 170 },
    ],
  },
  {
    id: "xray",
    ru: "Рентген",
    hint: "Тёмное стекло корпуса и светящиеся контуры механизма",
    wear: 0,
    chromas: [
      ["ice", "Лёд", "#05070d", "#0e2a3a", "#39d0ff", "#e8fbff"],
      ["acid", "Кислота", "#050a05", "#10301a", "#5dff7a", "#eaffef"],
      ["violet", "Фиалка", "#07050d", "#241040", "#b26bff", "#f4eaff"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Тёмное стекло" },
      { kind: "pattern", pattern: "circuit", colours: [0, 1, 2, 3], blend: "screen", name: "Механизм", scale: 80, glow: 80 },
      { kind: "pattern", pattern: "gradient", colours: [0, 1, 0, 0], blend: "screen", opacity: 45, name: "Просвет" },
    ],
    mag: [
      { kind: "fill", colour: 0, name: "Тёмное стекло" },
      { kind: "pattern", pattern: "circuit", colours: [0, 1, 2, 3], blend: "screen", name: "Механизм", scale: 80, glow: 80 },
    ],
  },
  {
    id: "dragon",
    ru: "Дракон",
    hint: "Чешуя и огонь в щелях",
    wear: 0,
    chromas: [
      ["fire", "Огонь", "#2a0f0a", "#8f1d10", "#e0612b", "#ffc86b"],
      ["emerald", "Изумруд", "#06170f", "#0f5132", "#2fbf71", "#b6ffd8"],
      ["frost", "Лёд", "#08131f", "#1f4e79", "#62b6f0", "#e6f6ff"],
      ["void", "Бездна", "#0a0612", "#3b1b6b", "#9b5de5", "#f1e3ff"],
    ],
    body: [
      { kind: "pattern", pattern: "scales", colours: [0, 1, 2, 3], name: "Чешуя" },
      { kind: "pattern", pattern: "lava", colours: [0, 0, 2, 3], blend: "screen", opacity: 45, name: "Жар", scale: 140 },
    ],
    mag: [
      { kind: "pattern", pattern: "scales", colours: [0, 1, 2, 3], name: "Чешуя", scale: 80 },
    ],
  },
  {
    id: "singularity",
    ru: "Сингулярность",
    hint: "Светящийся космос на корпусе",
    wear: 0,
    chromas: [
      ["nebula", "Туманность", "#05040d", "#3b1b6b", "#1b8fd1", "#ffffff"],
      ["redshift", "Красное смещение", "#0d0405", "#6b1b2a", "#f97316", "#ffffff"],
      ["aurora", "Сияние", "#020d0a", "#0f5d4a", "#34d399", "#ffffff"],
    ],
    body: [
      { kind: "pattern", pattern: "galaxy", colours: [0, 1, 2, 3], name: "Космос", glow: 45 },
    ],
    mag: [
      { kind: "fill", colour: 0, name: "Магазин патронов" },
    ],
  },
  {
    id: "reaper",
    ru: "Жнец",
    hint: "Тёмная кованая сталь с узором дамаска",
    wear: 6,
    chromas: [
      ["violet", "Фиолет", "#1b1d20", "#3a3d42", "#8b9097", "#c9ced4"],
      ["crimson", "Багрянец", "#1a1012", "#3d2226", "#8f5a60", "#d4b0b4"],
      ["spectre", "Призрак", "#101418", "#2e3a44", "#8aa0b0", "#e0ecf5"],
    ],
    body: [
      { kind: "pattern", pattern: "damascus", colours: [0, 1, 2, 3], name: "Дамаск" },
    ],
    mag: [
      { kind: "fill", colour: 0, name: "Магазин патронов" },
    ],
  },
  {
    id: "sakura",
    ru: "Сакура",
    hint: "Светлый мрамор в нежных тонах",
    wear: 0,
    chromas: [
      ["blossom", "Цветение", "#f7e8ec", "#e8b4c4", "#b87a8e", "#fffafc"],
      ["night", "Ночная", "#1a1420", "#4a2e45", "#d67aa3", "#ffe0ef"],
      ["jade", "Нефрит", "#e7f3ec", "#9fcfb3", "#4f8f6c", "#ffffff"],
    ],
    body: [
      { kind: "pattern", pattern: "marble", colours: [0, 1, 2, 3], name: "Мрамор" },
    ],
    mag: [
      { kind: "fill", colour: 1, name: "Магазин патронов" },
    ],
  },
  {
    id: "toxic",
    ru: "Токсик",
    hint: "Светящиеся брызги кислоты",
    wear: 18,
    chromas: [
      ["acid", "Кислота", "#101410", "#7cff00", "#1f3b12", "#d8ff6b"],
      ["hazard", "Опасность", "#141008", "#ffcc00", "#3b2f08", "#fff3a0"],
      ["plasma", "Плазма", "#0c0a14", "#c026d3", "#2a0f33", "#f0abfc"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Основа" },
      { kind: "pattern", pattern: "splatter", colours: [0, 1, 2, 3], name: "Брызги", glow: 65 },
    ],
    mag: [
      { kind: "fill", colour: 1, name: "Магазин патронов" },
    ],
  },
  {
    id: "cyber",
    ru: "Кибер",
    hint: "Светящиеся дорожки микросхемы",
    wear: 0,
    chromas: [
      ["matrix", "Матрица", "#0a0f0d", "#0f3d2e", "#35f2a6", "#b8ffe5"],
      ["blue", "Синий лёд", "#070b14", "#10254d", "#3ba7ff", "#d6ecff"],
      ["red", "Сбой", "#120608", "#3d0f16", "#ff2d55", "#ffd0d8"],
    ],
    body: [
      { kind: "pattern", pattern: "circuit", colours: [0, 1, 2, 3], name: "Схема", glow: 80 },
    ],
    mag: [
      { kind: "fill", colour: 0, name: "Магазин патронов" },
    ],
  },
  {
    id: "lava",
    ru: "Лава",
    hint: "Остывшая корка и огонь из трещин",
    wear: 0,
    chromas: [
      ["magma", "Магма", "#140c0a", "#2e1c17", "#ff4d0d", "#ffd04d"],
      ["blue", "Синее пламя", "#0a0c14", "#1c2233", "#2d7dff", "#b5e3ff"],
      ["venom", "Яд", "#0b140a", "#1a2e17", "#5dff0d", "#e4ff9e"],
    ],
    body: [
      { kind: "pattern", pattern: "lava", colours: [0, 1, 2, 3], name: "Лава", glow: 70 },
    ],
    mag: [
      { kind: "pattern", pattern: "lava", colours: [0, 1, 2, 3], name: "Лава", seed: 404, glow: 70 },
    ],
  },
  {
    id: "arctic",
    ru: "Лёд",
    hint: "Холодный камень с ледяными прожилками",
    wear: 0,
    chromas: [
      ["glacier", "Ледник", "#e6f2f8", "#a9cde0", "#5a8fae", "#ffffff"],
      ["deep", "Глубина", "#0c1a26", "#1e4a6b", "#7fc4e8", "#e6f6ff"],
    ],
    body: [
      { kind: "pattern", pattern: "marble", colours: [0, 1, 2, 3], name: "Лёд", scale: 140 },
    ],
    mag: [
      { kind: "fill", colour: 1, name: "Магазин патронов" },
    ],
  },
];

// Шаблоны под класс ствола (Ш19–Ш26)
const WEAPON_DEFS = [
  {
    id: "duotone",
    ru: "Двухтон",
    hint: "Затвор одним цветом, рамка другим — по форме этого ствола",
    wear: 0,
    classes: ALL_FAMILIES,
    chromas: [
      ["black-tan", "Чёрный и песок", "#1b1c1f", "#b59a6d", "#2a2b2f", "#d8c39b"],
      ["olive", "Олива", "#23251f", "#5c6340", "#3a3d31", "#8a9160"],
      ["arctic", "Белый", "#e9ecef", "#2b2e33", "#c9ced4", "#ffffff"],
      ["navy", "Синий", "#1a2433", "#c9ced4", "#2e3f5c", "#ffffff"],
    ],
    body: [
      { kind: "fill", colour: 1, name: "Рамка" },
      { kind: "fill", colour: 0, name: "Затвор", zone: "top" },
      { kind: "shade", opacity: 80 },
    ],
    mag: [
      { kind: "fill", colour: 0, name: "Магазин патронов" },
      { kind: "shade", opacity: 80 },
    ],
  },
  {
    id: "tactical",
    ru: "Тактика",
    hint: "Чёрный верх и песочный низ с цифровым камуфляжем",
    wear: 0,
    classes: ALL_FAMILIES,
    chromas: [
      ["desert", "Пустыня", "#151618", "#a58b65", "#2a2b2f", "#cdb48a"],
      ["ranger", "Рейнджер", "#151618", "#4a5038", "#2a2b2f", "#6f7752"],
      ["urban", "Город", "#151618", "#6b6f76", "#2a2b2f", "#9aa0a8"],
    ],
    body: [
      { kind: "fill", colour: 1, name: "Низ" },
      { kind: "pattern", pattern: "digital", colours: [1, 3, 2, 1], name: "Цифра", opacity: 45, blend: "overlay", zone: "bottom" },
      { kind: "fill", colour: 0, name: "Верх", zone: "top" },
      { kind: "shade", opacity: 85 },
    ],
    mag: [
      { kind: "fill", colour: 0, name: "Магазин патронов" },
      { kind: "shade", opacity: 85 },
    ],
  },
  {
    id: "police",
    ru: "Полиция",
    hint: "Служебный чёрный, надпись POLICE на затворе",
    wear: 0,
    classes: ["pistol", "smg", "shotgun", "rifle"],
    chromas: [
      ["lspd", "LSPD", "#111317", "#2a2f38", "#ffffff", "#1f4fa3"],
      ["sheriff", "Шериф", "#3a2f22", "#1c1712", "#e9d29a", "#6b5636"],
    ],
    body: [
      { kind: "fill", colour: 1, name: "Рамка" },
      { kind: "fill", colour: 0, name: "Затвор", zone: "top" },
      { kind: "shade", opacity: 85 },
    ],
    mag: [
      { kind: "fill", colour: 0, name: "Магазин патронов" },
      { kind: "shade", opacity: 85 },
    ],
    stickers: [
      { place: "gun-top", text: "POLICE", font: "stencil", size: 22, colour: 2 },
    ],
  },
  {
    id: "engraved",
    ru: "Гравировка",
    hint: "Золотой затвор с гравировкой и чёрная рамка",
    wear: 0,
    classes: ["pistol"],
    chromas: [
      ["gold", "Золото", "#c9962b", "#141414", "#f3d27a", "#8a5a12"],
      ["silver", "Серебро", "#b8bec6", "#141414", "#eef1f4", "#6b7078"],
    ],
    body: [
      { kind: "fill", colour: 1, name: "Рамка" },
      { kind: "fill", colour: 0, name: "Металл", blend: "color", zone: "top" },
      { kind: "pattern", pattern: "damascus", colours: [3, 0, 2, 3], name: "Гравировка", blend: "overlay", opacity: 70, zone: "top" },
    ],
    mag: [
      { kind: "fill", colour: 1, name: "Магазин патронов" },
    ],
    stickers: [
      { place: "gun-top", text: "ASTRAL", font: "serif", size: 20, colour: 2 },
    ],
  },
  {
    id: "racing",
    ru: "Гонка",
    hint: "Светлый корпус и гоночная полоса вдоль ствола",
    wear: 0,
    classes: ALL_FAMILIES,
    chromas: [
      ["red", "Красная", "#f2f2f2", "#d62828", "#1d1d1d", "#f7b32b"],
      ["blue", "Синяя", "#f2f2f2", "#1d5fd6", "#1d1d1d", "#9ec9ff"],
      ["lime", "Лайм", "#151618", "#a3e635", "#2a2b2f", "#ecfccb"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Корпус" },
      { kind: "fill", colour: 1, name: "Полоса", zone: "stripe" },
      { kind: "shade", opacity: 80 },
    ],
    mag: [
      { kind: "fill", colour: 2, name: "Магазин патронов" },
      { kind: "shade", opacity: 80 },
    ],
  },
  {
    id: "spec-ops",
    ru: "Спецназ",
    hint: "Матовый чёрный, светящееся цевьё, надпись SWAT на прикладе",
    wear: 0,
    classes: ["rifle", "smg", "machinegun", "shotgun"],
    chromas: [
      ["swat", "SWAT", "#121316", "#1f2126", "#e6e8eb", "#22d3ee"],
      ["ember", "Уголь", "#121316", "#1f2126", "#e6e8eb", "#f97316"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Корпус" },
      { kind: "fill", colour: 3, name: "Цевьё", glow: 60, zone: "front" },
      { kind: "shade", opacity: 85 },
    ],
    mag: [
      { kind: "fill", colour: 1, name: "Магазин патронов" },
      { kind: "shade", opacity: 85 },
    ],
    stickers: [
      { place: "gun-rear", text: "SWAT", font: "stencil", size: 16, colour: 2 },
    ],
  },
  {
    id: "hunter",
    ru: "Охотник",
    hint: "Дамасская сталь сверху, лесной камуфляж снизу",
    wear: 0,
    classes: ["shotgun", "sniper", "rifle"],
    chromas: [
      ["forest", "Лес", "#3a3d42", "#4b5b36", "#c9ced4", "#27301f"],
      ["autumn", "Осень", "#3a3d42", "#7a4a1f", "#c9ced4", "#3a2412"],
    ],
    body: [
      { kind: "pattern", pattern: "woodland", colours: [3, 1, 2, 3], name: "Камуфляж" },
      { kind: "pattern", pattern: "damascus", colours: [0, 2, 0, 3], name: "Сталь", zone: "top" },
      { kind: "shade", opacity: 80 },
    ],
    mag: [
      { kind: "fill", colour: 0, name: "Магазин патронов" },
      { kind: "shade", opacity: 80 },
    ],
  },
  {
    id: "winter",
    ru: "Зима",
    hint: "Белая цифра под снег и светлый верх",
    wear: 0,
    classes: ["sniper", "rifle"],
    chromas: [
      ["snow", "Снег", "#e9ecef", "#9aa3ad", "#ffffff", "#5c6670"],
    ],
    body: [
      { kind: "pattern", pattern: "digital", colours: [0, 1, 2, 0], name: "Снег" },
      { kind: "fill", colour: 2, name: "Верх", opacity: 70, zone: "top" },
      { kind: "shade", opacity: 80 },
    ],
    mag: [
      { kind: "fill", colour: 0, name: "Магазин патронов" },
      { kind: "shade", opacity: 80 },
    ],
  },
];

// Ткани одежды (Ш27–Ш42)
const CLOTHING_DEFS = [
  {
    id: "as-is",
    ru: "Как есть",
    hint: "Вещь без покраски — как в игре",
    wear: 0,
    chromas: [
      ["plain", "Заводская", "#3a3d44", "#3a3d44", "#3a3d44", "#3a3d44"],
    ],
    body: [],
  },
  {
    id: "dye",
    ru: "Однотон",
    hint: "Перекрасить вещь целиком — складки и швы остаются",
    wear: 0,
    chromas: [
      ["black", "Чёрный", "#161616", "#161616", "#161616", "#161616"],
      ["sand", "Песок", "#c9b28f", "#c9b28f", "#c9b28f", "#c9b28f"],
      ["khaki", "Хаки", "#5b5a3a", "#5b5a3a", "#5b5a3a", "#5b5a3a"],
      ["wine", "Бордо", "#6b1624", "#6b1624", "#6b1624", "#6b1624"],
      ["navy", "Тёмно-синий", "#1c2a4a", "#1c2a4a", "#1c2a4a", "#1c2a4a"],
      ["rose", "Розовый", "#e79ab5", "#e79ab5", "#e79ab5", "#e79ab5"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Цвет ткани", blend: "color" },
      { kind: "fill", colour: 0, name: "Глубина цвета", blend: "multiply", opacity: 45 },
    ],
  },
  {
    id: "tartan",
    ru: "Шотландка",
    hint: "Клетка крест-накрест, как у фланелевой рубашки",
    wear: 0,
    chromas: [
      ["red", "Красная", "#8e1b1b", "#1f2a44", "#0f3d24", "#e8c547"],
      ["forest", "Лесная", "#0f3d24", "#1f2a44", "#6b1624", "#e8c547"],
      ["grey", "Серая", "#6b6f76", "#2a2d33", "#a8acb3", "#d9534f"],
    ],
    body: [
      { kind: "pattern", pattern: "tartan", colours: [0, 1, 2, 3], name: "Клетка" },
      { kind: "shade" },
    ],
  },
  {
    id: "polka",
    ru: "Горох",
    hint: "Круглые точки рядами",
    wear: 0,
    chromas: [
      ["classic", "Классика", "#1d2b53", "#f4f1ea", "#f4f1ea", "#1d2b53"],
      ["retro", "Ретро", "#f3e6c9", "#c0392b", "#c0392b", "#f3e6c9"],
      ["punk", "Панк", "#141414", "#ff6fae", "#ff6fae", "#141414"],
    ],
    body: [
      { kind: "pattern", pattern: "polka", colours: [0, 1, 2, 3], name: "Горох" },
      { kind: "shade" },
    ],
  },
  {
    id: "tie-dye",
    ru: "Тай-дай",
    hint: "Спираль разводов, как у футболок узелкового крашения",
    wear: 0,
    chromas: [
      ["rainbow", "Радуга", "#ff3d7f", "#ffd23f", "#3bceac", "#5c4bd1"],
      ["pastel", "Пастель", "#f7c5d9", "#fbe7a1", "#b8e6d6", "#c9c1f2"],
      ["acid", "Кислота", "#b6ff00", "#00e5ff", "#ff00c8", "#fff200"],
    ],
    body: [
      { kind: "pattern", pattern: "tiedye", colours: [0, 1, 2, 3], name: "Тай-дай" },
      { kind: "shade" },
    ],
  },
  {
    id: "leopard",
    ru: "Леопард",
    hint: "Пятна-розетки на меху",
    wear: 0,
    chromas: [
      ["classic", "Классика", "#d9a35b", "#8a5a24", "#2a1a10", "#6b4423"],
      ["pink", "Розовый", "#f2a7c3", "#c2527f", "#2a1a22", "#8d3b5f"],
      ["snow", "Снежный", "#ececec", "#b3b3b3", "#222222", "#8d8d8d"],
    ],
    body: [
      { kind: "pattern", pattern: "leopard", colours: [0, 1, 2, 3], name: "Леопард" },
      { kind: "shade" },
    ],
  },
  {
    id: "zebra",
    ru: "Зебра",
    hint: "Чёткие извилистые полосы",
    wear: 0,
    chromas: [
      ["classic", "Классика", "#f5f5f2", "#101010", "#101010", "#f5f5f2"],
      ["neon", "Неон", "#101010", "#39ff14", "#39ff14", "#101010"],
    ],
    body: [
      { kind: "pattern", pattern: "zebra", colours: [0, 1, 2, 3], name: "Зебра" },
      { kind: "shade" },
    ],
  },
  {
    id: "denim",
    ru: "Деним",
    hint: "Джинсовая саржа с вытертостями",
    wear: 0,
    chromas: [
      ["indigo", "Индиго", "#1f3a5f", "#2c5282", "#4a6fa5", "#c9d6e8"],
      ["black", "Чёрный", "#1b1d22", "#2c2f36", "#4a4e57", "#a6abb5"],
      ["bleach", "Выбеленный", "#7fa1c9", "#9bb7d9", "#c3d4ea", "#eef3fa"],
    ],
    body: [
      { kind: "pattern", pattern: "denim", colours: [0, 1, 2, 3], name: "Деним" },
      { kind: "shade" },
    ],
  },
  {
    id: "houndstooth",
    ru: "Гусиная лапка",
    hint: "Классическая ломаная клетка пиджаков",
    wear: 0,
    chromas: [
      ["classic", "Классика", "#f2eee6", "#161616", "#161616", "#f2eee6"],
      ["camel", "Кэмел", "#e8dcc3", "#6b4f2a", "#6b4f2a", "#e8dcc3"],
    ],
    body: [
      { kind: "pattern", pattern: "houndstooth", colours: [0, 1, 2, 3], name: "Гусиная лапка" },
      { kind: "shade" },
    ],
  },
  {
    id: "camo",
    ru: "Камуфляж",
    hint: "Армейские пятна",
    wear: 0,
    chromas: [
      ["forest", "Лес", "#27301f", "#4b5b36", "#7a6a45", "#141712"],
      ["desert", "Пустыня", "#c2a878", "#a0835a", "#6e5a3c", "#e3d2a6"],
      ["urban", "Город", "#8c9094", "#5a5e63", "#c4c7ca", "#2b2e31"],
    ],
    body: [
      { kind: "pattern", pattern: "woodland", colours: [0, 1, 2, 3], name: "Камуфляж" },
      { kind: "shade" },
    ],
  },
  {
    id: "digicamo",
    ru: "Цифра",
    hint: "Пиксельный камуфляж",
    wear: 0,
    chromas: [
      ["forest", "Лес", "#3b4034", "#5e6650", "#8a8f73", "#22251e"],
      ["snow", "Зима", "#e9ecef", "#b8bfc6", "#7e8790", "#ffffff"],
    ],
    body: [
      { kind: "pattern", pattern: "digital", colours: [0, 1, 2, 3], name: "Цифра" },
      { kind: "shade" },
    ],
  },
  {
    id: "ombre",
    ru: "Омбре",
    hint: "Плавный переход цвета по вещи",
    wear: 0,
    chromas: [
      ["sunset", "Закат", "#ff6a00", "#ee0979", "#7b2ff7", "#140a0a"],
      ["ocean", "Океан", "#0f2027", "#2c5364", "#4ecdc4", "#f7fff7"],
      ["peach", "Персик", "#ffd1a9", "#ff9a8b", "#ff6a88", "#2b1b17"],
    ],
    body: [
      { kind: "pattern", pattern: "gradient", colours: [0, 1, 2, 3], name: "Омбре", rotation: 90 },
      { kind: "shade" },
    ],
  },
  {
    id: "graffiti",
    ru: "Граффити",
    hint: "Брызги баллончика поверх ткани",
    wear: 0,
    chromas: [
      ["street", "Улица", "#141414", "#ff3d7f", "#3dffd0", "#ffe14d"],
      ["pastel", "Пастель", "#f4f1ea", "#f7a8c4", "#9ad7e6", "#f9e18a"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Основа", blend: "color" },
      { kind: "pattern", pattern: "splatter", colours: [0, 1, 2, 3], name: "Брызги" },
      { kind: "shade" },
    ],
  },
  {
    id: "checker",
    ru: "Шахматка",
    hint: "Квадраты через один, как у скейтерских кед",
    wear: 0,
    chromas: [
      ["classic", "Классика", "#f5f5f5", "#111111", "#111111", "#f5f5f5"],
      ["red", "Красная", "#f5f5f5", "#b3261e", "#b3261e", "#f5f5f5"],
    ],
    body: [
      { kind: "pattern", pattern: "checker", colours: [0, 1, 2, 3], name: "Шахматка" },
      { kind: "shade" },
    ],
  },
  {
    id: "stripe",
    ru: "Полоска",
    hint: "Полосы поперёк, как у тельняшки",
    wear: 0,
    chromas: [
      ["sailor", "Тельняшка", "#f5f5f2", "#1d2b53", "#1d2b53", "#f5f5f2"],
      ["sport", "Спорт", "#141414", "#f5f5f2", "#d62828", "#f5f5f2"],
    ],
    body: [
      { kind: "pattern", pattern: "stripes", colours: [0, 1, 2, 3], name: "Полоска", scale: 60 },
      { kind: "shade" },
    ],
  },
  {
    id: "neon-cloth",
    ru: "Неон",
    hint: "Кислотный градиент ярких цветов",
    wear: 0,
    chromas: [
      ["pop", "Поп", "#7b2ff7", "#f107a3", "#00d4ff", "#0b0b12"],
      ["mint", "Мята", "#00c9a7", "#845ec2", "#c4fcef", "#0b1412"],
    ],
    body: [
      { kind: "pattern", pattern: "gradient", colours: [0, 1, 2, 3], name: "Неон" },
      { kind: "shade", opacity: 60 },
    ],
  },
];

// Принты (Ш43–Ш45)
const PRINT_DEFS = [
  {
    id: "print",
    ru: "Надпись",
    hint: "Однотонная вещь и надпись спереди, как у футболки с принтом",
    wear: 0,
    chromas: [
      ["black", "Чёрная", "#161616", "#f4f1ea", "#f4f1ea", "#161616"],
      ["white", "Белая", "#eeece6", "#161616", "#161616", "#eeece6"],
      ["red", "Красная", "#8e1b1b", "#f4f1ea", "#f4f1ea", "#8e1b1b"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Цвет ткани", blend: "color" },
      { kind: "fill", colour: 0, name: "Глубина цвета", blend: "multiply", opacity: 45 },
    ],
    stickers: [
      { place: "chest", text: "LOS SANTOS", source: "", font: "gothic", size: 34, colour: 1, outline: 0 },
    ],
  },
  {
    id: "back-print",
    ru: "Надпись на спине",
    hint: "Однотон и крупная надпись через всю спину",
    wear: 0,
    chromas: [
      ["black", "Чёрная", "#161616", "#e8c547", "#e8c547", "#161616"],
      ["olive", "Олива", "#3f4a2c", "#f4f1ea", "#f4f1ea", "#3f4a2c"],
      ["navy", "Тёмно-синяя", "#1c2a4a", "#f4f1ea", "#f4f1ea", "#1c2a4a"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Цвет ткани", blend: "color" },
      { kind: "fill", colour: 0, name: "Глубина цвета", blend: "multiply", opacity: 45 },
    ],
    stickers: [
      { place: "back", text: "LOS SANTOS", source: "", font: "stencil", size: 48, colour: 1, outline: 0 },
    ],
  },
  {
    id: "jersey",
    ru: "Джерси",
    hint: "Спортивная форма: цвет команды и номер на спине и на груди",
    wear: 0,
    chromas: [
      ["home", "Домашняя", "#1c2a4a", "#f4f1ea", "#f4f1ea", "#1c2a4a"],
      ["away", "Гостевая", "#f2f0ea", "#8e1b1b", "#8e1b1b", "#f2f0ea"],
      ["gold", "Золото", "#6b1624", "#e8c547", "#e8c547", "#6b1624"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Цвет ткани", blend: "color" },
      { kind: "fill", colour: 0, name: "Глубина цвета", blend: "multiply", opacity: 45 },
    ],
    stickers: [
      { place: "back", text: "23", source: "", font: "sans", size: 60, colour: 1, outline: 4 },
      { place: "chest", text: "23", source: "", font: "sans", size: 22, colour: 1, outline: 2 },
    ],
  },
];

// Тату (Ш46–Ш53)
const TATTOO_DEFS = [
  {
    id: "tattoo-blackwork",
    ru: "Полный блэкворк",
    hint: "Тело, руки и ноги залиты чернилами — голова и лицо чистые",
    wear: 0,
    backdrop: "#a8765a",
    chromas: [
      ["black", "Чёрные чернила", "#141414", "#141414", "#141414", "#141414"],
      ["blue", "Синие", "#1d2b4a", "#1d2b4a", "#1d2b4a", "#1d2b4a"],
      ["red", "Красные", "#7a1c1c", "#7a1c1c", "#7a1c1c", "#7a1c1c"],
      ["white", "Белые", "#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Блэкворк", only: "^tattoo_(?:torso|arm|leg)" },
    ],
    stickers: [],
  },
  {
    id: "tattoo-blackwork-all",
    ru: "Блэкворк целиком",
    hint: "Чернила по всему телу, вместе с головой и лицом",
    wear: 0,
    backdrop: "#a8765a",
    chromas: [
      ["black", "Чёрные чернила", "#141414", "#141414", "#141414", "#141414"],
      ["blue", "Синие", "#1d2b4a", "#1d2b4a", "#1d2b4a", "#1d2b4a"],
      ["red", "Красные", "#7a1c1c", "#7a1c1c", "#7a1c1c", "#7a1c1c"],
      ["white", "Белые", "#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2"],
    ],
    body: [
      { kind: "fill", colour: 0, name: "Блэкворк", only: "^tattoo_" },
    ],
    stickers: [],
  },
  {
    id: "tattoo-set-oldschool",
    ru: "Набор: олд-скул",
    hint: "Череп на левом плече, корона над сердцем и надпись на груди",
    wear: 0,
    backdrop: "#a8765a",
    chromas: [
      ["black", "Чёрные чернила", "#141414", "#141414", "#141414", "#141414"],
      ["blue", "Синие", "#1d2b4a", "#1d2b4a", "#1d2b4a", "#1d2b4a"],
      ["red", "Красные", "#7a1c1c", "#7a1c1c", "#7a1c1c", "#7a1c1c"],
      ["white", "Белые", "#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2"],
    ],
    body: [],
    stickers: [
      { place: "sleeve-left", text: "", source: "emblem:skull-fill", font: "sans", size: 24, colour: 0, outline: 0 },
      { place: "heart", text: "", source: "emblem:crown-fill", font: "sans", size: 16, colour: 0, outline: 0 },
      { place: "chest", text: "Los Santos", source: "", font: "script", size: 32, colour: 0, outline: 0 },
    ],
  },
  {
    id: "tattoo-set-script",
    ru: "Набор: надписи",
    hint: "Надпись на груди и готика поперёк лопаток",
    wear: 0,
    backdrop: "#a8765a",
    chromas: [
      ["black", "Чёрные чернила", "#141414", "#141414", "#141414", "#141414"],
      ["blue", "Синие", "#1d2b4a", "#1d2b4a", "#1d2b4a", "#1d2b4a"],
      ["red", "Красные", "#7a1c1c", "#7a1c1c", "#7a1c1c", "#7a1c1c"],
      ["white", "Белые", "#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2"],
    ],
    body: [],
    stickers: [
      { place: "chest", text: "Loyalty", source: "", font: "script", size: 36, colour: 0, outline: 0 },
      { place: "back", text: "Blessed", source: "", font: "gothic", size: 44, colour: 0, outline: 0 },
    ],
  },
  {
    id: "tattoo-script",
    ru: "Надпись",
    hint: "Надпись курсивом на груди — как из тату-салона",
    wear: 0,
    backdrop: "#a8765a",
    chromas: [
      ["black", "Чёрные чернила", "#141414", "#141414", "#141414", "#141414"],
      ["blue", "Синие", "#1d2b4a", "#1d2b4a", "#1d2b4a", "#1d2b4a"],
      ["red", "Красные", "#7a1c1c", "#7a1c1c", "#7a1c1c", "#7a1c1c"],
      ["white", "Белые", "#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2"],
    ],
    body: [],
    stickers: [
      { place: "chest", text: "Los Santos", source: "", font: "script", size: 40, colour: 0, outline: 0 },
    ],
  },
  {
    id: "tattoo-back",
    ru: "Надпись на спине",
    hint: "Готическая надпись поперёк лопаток",
    wear: 0,
    backdrop: "#a8765a",
    chromas: [
      ["black", "Чёрные чернила", "#141414", "#141414", "#141414", "#141414"],
      ["blue", "Синие", "#1d2b4a", "#1d2b4a", "#1d2b4a", "#1d2b4a"],
      ["red", "Красные", "#7a1c1c", "#7a1c1c", "#7a1c1c", "#7a1c1c"],
      ["white", "Белые", "#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2"],
    ],
    body: [],
    stickers: [
      { place: "back", text: "Blessed", source: "", font: "gothic", size: 46, colour: 0, outline: 0 },
    ],
  },
  {
    id: "tattoo-shoulder",
    ru: "Эмблема на плече",
    hint: "Череп на плече — классика олд-скула",
    wear: 0,
    backdrop: "#a8765a",
    chromas: [
      ["black", "Чёрные чернила", "#141414", "#141414", "#141414", "#141414"],
      ["blue", "Синие", "#1d2b4a", "#1d2b4a", "#1d2b4a", "#1d2b4a"],
      ["red", "Красные", "#7a1c1c", "#7a1c1c", "#7a1c1c", "#7a1c1c"],
      ["white", "Белые", "#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2"],
    ],
    body: [],
    stickers: [
      { place: "sleeve-left", text: "", source: "emblem:skull-fill", font: "sans", size: 26, colour: 0, outline: 0 },
    ],
  },
  {
    id: "tattoo-heart",
    ru: "Эмблема на сердце",
    hint: "Корона над сердцем",
    wear: 0,
    backdrop: "#a8765a",
    chromas: [
      ["black", "Чёрные чернила", "#141414", "#141414", "#141414", "#141414"],
      ["blue", "Синие", "#1d2b4a", "#1d2b4a", "#1d2b4a", "#1d2b4a"],
      ["red", "Красные", "#7a1c1c", "#7a1c1c", "#7a1c1c", "#7a1c1c"],
      ["white", "Белые", "#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2"],
    ],
    body: [],
    stickers: [
      { place: "heart", text: "", source: "emblem:crown-fill", font: "sans", size: 18, colour: 0, outline: 0 },
    ],
  },
];

const CLOTHING_SET_IDS = {
  tshirts: ["as-is", "dye", "print", "back-print", "jersey", "stripe", "tartan", "tie-dye", "camo", "graffiti", "ombre", "neon-cloth"],
  pants: ["as-is", "dye", "denim", "camo", "digicamo", "houndstooth", "checker", "ombre"],
  shoes: ["as-is", "dye", "checker", "camo", "leopard", "zebra", "graffiti", "neon-cloth"],
  masks: ["as-is", "dye", "camo", "digicamo", "graffiti", "leopard", "zebra", "neon-cloth"],
  hats: ["as-is", "dye", "print", "camo", "denim", "checker", "tartan"],
  accessories: ["as-is", "dye", "ombre", "leopard", "checker", "neon-cloth"],
  gloves: ["as-is", "dye", "camo", "digicamo", "leopard", "zebra"],
  bags: ["as-is", "dye", "print", "camo", "digicamo", "denim", "graffiti", "checker", "leopard"],
  armor: ["as-is", "dye", "back-print", "camo", "digicamo", "graffiti"],
  tattoos: ["as-is", "tattoo-blackwork", "tattoo-blackwork-all", "tattoo-set-oldschool", "tattoo-set-script", "tattoo-script", "tattoo-back", "tattoo-shoulder", "tattoo-heart"],
};

// ---- Сборка таблиц: порядок ключей у каждого вида шаблона виден снаружи ----

const labelOf = (ru) => freeze({ ru });
const chromasOf = (rows) =>
  freeze(
    rows.map(([id, ru, ...palette]) =>
      freeze({ id, label: labelOf(ru), palette: freeze(palette) }),
    ),
  );
const frozenEach = (list) => freeze(list.map((item) => freeze(item)));

function commonTemplate(def, mag) {
  return {
    id: def.id,
    ru: def.ru,
    hint: labelOf(def.hint),
    chromas: chromasOf(def.chromas),
    body: def.body,
    mag,
    wear: def.wear,
    label: labelOf(def.ru),
  };
}

// У одежды, принтов и тату корпус и магазин — один и тот же список слоёв.
const clothTemplate = (def) => freeze(commonTemplate(def, def.body));

const printTemplate = (def) =>
  freeze({ ...commonTemplate(def, def.body), stickers: frozenEach(def.stickers) });

const tattooTemplate = (def) =>
  freeze({ ...printTemplate(def), backdrop: def.backdrop });

function weaponTemplate(def) {
  return freeze({
    wear: def.wear,
    mag: def.mag,
    id: def.id,
    ru: def.ru,
    hint: labelOf(def.hint),
    classes: def.classes,
    chromas: chromasOf(def.chromas),
    body: def.body,
    ...(def.stickers ? { stickers: def.stickers } : {}),
    label: labelOf(def.ru),
  });
}

export const TEMPLATES = freeze(GENERAL_DEFS.map((def) => freeze(commonTemplate(def, def.mag))));
export const WEAPON_TEMPLATES = freeze(WEAPON_DEFS.map(weaponTemplate));
export const CLOTHING_TEMPLATES = freeze(CLOTHING_DEFS.map(clothTemplate));
export const CLOTHING_TEMPLATE_SETS = freeze(CLOTHING_SET_IDS);

// Порядок поиска: общие, под ствол, одежда, принты, тату; при одинаковом id побеждает первый.
const TEMPLATES_BY_ID = new Map();
for (const template of [
  ...TEMPLATES,
  ...WEAPON_TEMPLATES,
  ...CLOTHING_TEMPLATES,
  ...PRINT_DEFS.map(printTemplate),
  ...TATTOO_DEFS.map(tattooTemplate),
]) {
  if (!TEMPLATES_BY_ID.has(template.id)) TEMPLATES_BY_ID.set(template.id, template);
}

// ---- Поиск и списки ----

export function findTemplate(id) {
  return TEMPLATES_BY_ID.get(id) ?? null;
}

export function weaponTemplatesFor(family) {
  return WEAPON_TEMPLATES.filter((template) => template.classes.includes(family));
}

export function clothingTemplatesFor(slotId) {
  const ids = Object.hasOwn(CLOTHING_TEMPLATE_SETS, slotId) ? CLOTHING_TEMPLATE_SETS[slotId] : null;
  return ids ? ids.map((id) => findTemplate(id)).filter(Boolean) : CLOTHING_TEMPLATES;
}

export function templateZones(templateId) {
  const template = findTemplate(templateId);
  const specs = template ? [...template.body, ...template.mag] : [];
  return [...new Set(specs.map((spec) => spec.zone).filter(Boolean))];
}

// ---- Посадка узора на развёртку детали ----

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roundToTenth = (value) => Math.round(value * 10) / 10;
// Угол в полуинтервал [-180, 180): ровно 180 становится -180.
const wrapDegrees = (angle) => angle - 360 * Math.floor((angle + 180) / 360);

export function fitPatternLayer(layer, fit) {
  const fittable = layer?.kind === "pattern" && fit?.density > 0;
  if (!fittable) return layer;

  const scale = clamp(
    Math.round((layer.scale * fit.density) / FIT_REFERENCE.density),
    PATTERN_SCALE_RANGE.min,
    PATTERN_SCALE_RANGE.max,
  );
  const aligned = fit.coherence >= COHERENCE_MIN && Number.isFinite(fit.angle);
  const rotation = aligned
    ? roundToTenth(wrapDegrees(layer.rotation - (fit.angle - FIT_REFERENCE.angle)))
    : layer.rotation;
  return { ...layer, scale, rotation };
}

// ---- Наклейки шаблона ----

// Номер цвета берётся по модулю длины палитры; готовая строка «#rrggbb» остаётся как есть.
function paletteColour(palette, pick) {
  if (typeof pick !== "number") return pick;
  return palette[pick % palette.length];
}

const pickChroma = (template, chromaId) =>
  template.chromas.find((chroma) => chroma.id === chromaId) ?? template.chromas[0];

// Поля наклейки шаблона в порядке выдачи; второй аргумент — подпись шаблона и палитра расцветки.
const STICKER_FIELDS = [
  ["name", (spec, scene) => STICKER_PREFIX + (spec.text || scene.title)],
  ["text", (spec) => spec.text],
  ["source", (spec) => spec.source || undefined],
  ["font", (spec) => spec.font],
  ["size", (spec) => spec.size],
  ["tint", (spec, scene) => paletteColour(scene.palette, spec.colour)],
  ["outline", (spec) => spec.outline],
  ["outlineColour", (spec, scene) => paletteColour(scene.palette, 0)],
];

export function templateStickers(templateId, chromaId = "") {
  const template = findTemplate(templateId);
  const specs = template?.stickers ?? [];
  if (specs.length === 0) return [];
  const scene = { title: template.label.ru, palette: pickChroma(template, chromaId).palette };
  return specs.map((spec) => ({
    place: spec.place,
    sticker: Object.fromEntries(STICKER_FIELDS.map(([key, make]) => [key, make(spec, scene)])),
  }));
}

export function placeTemplateSticker({ sticker }, hit) {
  return createSticker(Object.assign({}, sticker, { anchor: hit.point, normal: hit.normal }));
}

// Копии готовых наклеек: глубокие, чтобы в проекте лежали другие объекты.
function* copiesOf(placed) {
  for (const item of placed) yield structuredClone(item);
}

export function withTemplateStickers(project, placed = []) {
  const handMade = (sticker) => !String(sticker?.name).startsWith(STICKER_PREFIX);
  project.stickers = (project.stickers ?? []).filter(handMade);
  for (const copy of copiesOf(placed)) addSticker(project, copy);
  return project;
}

// ---- Применение шаблона ----

// Запасные значения описания слоя по виду. Пустое имя и пустой режим тоже заменяются запасными,
// у чисел запасное берётся только при отсутствии поля (ноль остаётся нулём).
const LAYER_FALLBACKS = {
  shade: { name: "Светотень", contrast: 100, opacity: 85, blend: "overlay" },
  fill: { name: "Заливка", blend: "source-over", opacity: 100, glow: 0 },
  pattern: {
    name: "Узор", scale: 100, rotation: 0, seed: 0, blend: "source-over", opacity: 100, glow: 0,
  },
};
const EMPTY_MEANS_MISSING = new Set(["name", "blend"]);
const PAINT_KEYS = ["blend", "opacity", "glow"];

function completed(spec, kind) {
  return Object.fromEntries(
    Object.entries(LAYER_FALLBACKS[kind]).map(([key, fallback]) => [
      key,
      EMPTY_MEANS_MISSING.has(key) ? spec[key] || fallback : (spec[key] ?? fallback),
    ]),
  );
}

// Режим, прозрачность и свечение пишутся поверх созданного слоя как есть.
const withPaint = (layer, values) =>
  Object.assign(layer, Object.fromEntries(PAINT_KEYS.map((key) => [key, values[key]])));

const LAYER_MAKERS = new Map([
  ["shade", (values) => createShadeLayer(values)],
  [
    "fill",
    (values, spec, palette) =>
      withPaint(
        createFillLayer({ name: values.name, colour: paletteColour(palette, spec.colour) }),
        values,
      ),
  ],
  [
    "pattern",
    (values, spec, palette) =>
      withPaint(
        createPatternLayer({
          name: values.name,
          pattern: spec.pattern,
          colours: spec.colours.map((pick) => paletteColour(palette, pick)),
          scale: values.scale,
          rotation: values.rotation,
          seed: values.seed,
        }),
        values,
      ),
  ],
]);

// Всё, что не светотень и не заливка, — узор.
function buildLayer(spec, palette) {
  const kind = spec.kind === "shade" || spec.kind === "fill" ? spec.kind : "pattern";
  return LAYER_MAKERS.get(kind)(completed(spec, kind), spec, palette);
}

function specsForRole(template, role) {
  if (BODY_ROLES.has(role)) return template.body;
  return role === "mag" ? template.mag : [];
}

// Стопка слоёв детали сверху вниз: описания идут снизу вверх, каждое следующее ложится выше.
function layerStack(material, template, chroma, fits, masks) {
  const stack = [];
  for (const spec of specsForRole(template, materialRole(material.name))) {
    if (spec.only && !new RegExp(spec.only, "i").test(material.name)) continue;
    // Слой создаётся (и берёт номер) даже тогда, когда зона без маски его отбросит.
    const layer = fitPatternLayer(buildLayer(spec, chroma.palette), fits?.[material.name]);
    const mask = spec.zone ? masks?.[material.name]?.[spec.zone] : null;
    if (spec.zone && !mask) continue;
    stack.unshift(spec.zone ? Object.assign(layer, { mask }) : layer);
  }
  return stack;
}

// Потёртость шаблона заменяет прежнюю целиком, кроме сида.
const templateWear = (template, previous) =>
  createWear({ amount: template.wear, seed: previous?.seed || 0 });

export function applyTemplate(project, templateId, chromaId = "", options = {}) {
  const [fits, masks] = [options.fits, options.masks].map((value) => value ?? null);

  const template = findTemplate(templateId);
  if (!template) throw new Error(`Нет такого шаблона: ${templateId}`);
  const chroma = pickChroma(template, chromaId);

  const next = structuredClone(project);
  next.template = template.id;
  next.chroma = chroma.id;
  for (const material of next.materials) {
    material.layers = layerStack(material, template, chroma, fits, masks);
  }
  next.wear = templateWear(template, next.wear);
  return next;
}

// ---- Случайный скин ----

const NOT_ROLLED = new Set(["factory", "as-is"]);
const SEED_RANGE = 1000;
const MAX_WORN = 45;

// Номер элемента списка длины n по числу из источника; NaN и минус дают номер вне списка.
const pickIndex = (roll, length) => Math.min(Math.floor(roll * length), length - 1);
const wornAmount = (roll) => Math.round(roll * roll * MAX_WORN);

export function rollSkin(project, options = {}) {
  const random = options.random === undefined ? Math.random : options.random;
  const templates = options.templates === undefined ? TEMPLATES : options.templates;
  const worn = options.worn === undefined ? true : options.worn;

  const pool = templates.filter((template) => !NOT_ROLLED.has(template.id));
  const template = pool[pickIndex(random(), pool.length)];
  const chroma = template.chromas[pickIndex(random(), template.chromas.length)];

  const skin = applyTemplate(project, template.id, chroma.id, { fits: options.fits });
  skin.materials
    .flatMap((material) => material.layers)
    .filter((layer) => layer.kind === "pattern")
    .forEach((layer) => {
      layer.seed = Math.floor(random() * SEED_RANGE);
    });

  const amount = worn ? wornAmount(random()) : 0;
  skin.wear = createWear({ amount, seed: Math.floor(random() * SEED_RANGE) });
  return skin;
}
