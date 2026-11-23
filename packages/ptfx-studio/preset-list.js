/*
 * Список готовых пресетов — одни данные, без разбора проекта.
 *
 * Пресеты видны в каталоге у всех, кто его открыл, а мастерская грузится по
 * нажатию. Разбор проекта (`presets.js` → `project.js` → `impact.js`) тянет
 * за собой выписку правил эффектов игры, и через каталог она ложилась в
 * общий кусок приложения — за его бюджет. Поэтому здесь только то, что пресет
 * говорит о себе: имя, описание, цвет и заказ (`spec`), из которого
 * `presets.js` собирает настоящий проект. Импортов у этого файла нет и быть
 * не должно — это держит тест.
 */

/* Заказ пресета — данные как есть: проект из него собирает `presets.js`. */
const spec = (value) => Object.freeze(value);

/*
 * Зона пресета — всегда стопка слоёв, а не набор полей поверх умолчаний:
 * смешивать две схемы в одном объекте нельзя, и разбор это честно отвергает.
 */
function zone(layers, extra = {}) {
  return { enabled: true, layers, ...extra };
}

/* Кровь своим цветом в обеих зонах; голове — чуть сильнее, как и в игре. */
const blood = (colour, amount, headAmount = Math.min(1, amount + 0.15)) => ({
  head: zone([{ kind: "blood", colour, amount: headAmount }]),
  body: zone([{ kind: "blood", colour, amount }]),
});

/* Один и тот же слой в обеих зонах — с поправкой для головы. */
const both = (layer, head = {}) => ({
  head: zone([{ ...layer, ...head }]),
  body: zone([layer]),
});

/* Семейство огня и взрывов на самой низкой плотности, что даёт редактор. */
const thinned = Object.freeze({ enabled: true, opacity: 0.2 });

/* Один и тот же слой из раны и из спины — в обеих зонах. */
const bothSides = (layer) => ({
  head: zone([layer, { ...layer, placement: "back" }]),
  body: zone([layer, { ...layer, placement: "back" }]),
});

export const PTFX_PRESET_LIST = Object.freeze([
  Object.freeze({
    id: "vanilla-plus",
    label: "Ванильный+",
    description: "Оригинальный характер, но след и брызги заметнее.",
    accent: "#ff9a3c",
    spec: spec({
      name: "Ванильный+",
      tracer: {
        enabled: true,
        style: "classic",
        colour: "#ff8a1e",
        coreColour: "#fff4d6",
        thickness: 0.4,
        length: 0.55,
        glow: 0.45,
        chanceSP: 0.6,
        chanceMP: 0.8,
      },
      impact: { enabled: true },
      zones: blood("#8f1111", 0.65),
    }),
  }),
  Object.freeze({
    id: "cinematic",
    label: "Кинематографичный",
    description: "Густая тёмная кровь, широкий разлёт, тёплый след.",
    accent: "#c8452f",
    spec: spec({
      name: "Кинематографичный",
      tracer: {
        enabled: true,
        style: "trail",
        colour: "#ff6a2a",
        coreColour: "#ffd9a8",
        thickness: 0.55,
        length: 0.85,
        glow: 0.35,
        chanceSP: 0.45,
        chanceMP: 0.7,
      },
      impact: { enabled: true },
      zones: blood("#6d0d0d", 0.75, 0.95),
    }),
  }),
  Object.freeze({
    id: "realism",
    label: "Реализм",
    description: "Тёмная кровь малыми брызгами — не закрывает прицел.",
    accent: "#7a1220",
    spec: spec({
      name: "Реализм",
      tracer: {
        enabled: true,
        style: "classic",
        colour: "#d98a3a",
        coreColour: "#ffe6bf",
        thickness: 0.22,
        length: 0.35,
        glow: 0.18,
        chanceSP: 0.12,
        chanceMP: 0.25,
      },
      impact: { enabled: true },
      zones: blood("#5d0a12", 0.3, 0.45),
    }),
  }),
  Object.freeze({
    id: "brutality",
    label: "Жесть",
    description: "Яркая кровь во всю силу: огромный разлёт от каждой пули.",
    accent: "#e2211c",
    spec: spec({
      name: "Жесть",
      tracer: {
        enabled: true,
        style: "comet",
        colour: "#ff2d16",
        coreColour: "#ffffff",
        thickness: 0.6,
        length: 0.7,
        glow: 0.8,
        chanceSP: 1,
        chanceMP: 1,
      },
      impact: { enabled: true },
      zones: blood("#d21818", 0.95, 1),
    }),
  }),
  Object.freeze({
    id: "neon",
    label: "Неон",
    description: "Бирюзовый след и малиновая кровь — откровенная стилизация.",
    accent: "#22d3ee",
    spec: spec({
      name: "Неон",
      tracer: {
        enabled: true,
        style: "beam",
        colour: "#22d3ee",
        coreColour: "#ecfeff",
        thickness: 0.3,
        length: 0.9,
        glow: 0.9,
        chanceSP: 1,
        chanceMP: 1,
      },
      impact: { enabled: true },
      zones: {
        head: zone([{ kind: "blood", colour: "#e879f9", amount: 0.8 }]),
        body: zone([{ kind: "blood", colour: "#f472b6", amount: 0.6 }]),
      },
    }),
  }),
  Object.freeze({
    id: "railgun",
    label: "Рельсотрон",
    description: "Только след: белая сердцевина в синем ореоле.",
    accent: "#60a5fa",
    spec: spec({
      name: "Рельсотрон",
      tracer: {
        enabled: true,
        style: "railgun",
        colour: "#3b82f6",
        coreColour: "#ffffff",
        thickness: 0.5,
        length: 1,
        glow: 1,
        chanceSP: 1,
        chanceMP: 1,
      },
      impact: { enabled: false },
    }),
  }),
  Object.freeze({
    id: "rgb-tracer",
    label: "RGB-след",
    description: "Только след: переливается всеми цветами сам, как подсветка.",
    accent: "#a855f7",
    spec: spec({
      name: "RGB-след",
      tracer: {
        style: "beam",
        colours: ["#ff2d16"],
        colourMode: "rainbow",
        coreColour: "#ffffff",
        thickness: 0.4,
        length: 0.85,
        glow: 0.9,
        chanceSP: 1,
        chanceMP: 1,
      },
      impact: { enabled: false },
    }),
  }),
  Object.freeze({
    id: "tricolour-tracer",
    label: "Триколор",
    description: "Только след: зелёная голова, синяя середина, оранжевый хвост.",
    accent: "#22d3ee",
    spec: spec({
      name: "Триколор",
      tracer: {
        style: "plasma",
        colours: ["#84cc16", "#3b82f6", "#ff7a1a"],
        colourMode: "gradient",
        coreColour: "#ffffff",
        thickness: 0.5,
        length: 0.9,
        glow: 0.7,
        chanceSP: 1,
        chanceMP: 1,
      },
      impact: { enabled: false },
    }),
  }),
  /*
   * Пак «Новые эффекты» (ТЗ 10.10.2026, задача 13). Его core.ypt рисует
   * штатный след пули тонкой бело-голубой нитью (свой лист: линия в два
   * пикселя вместо полосы, правило крупнее в 1,6 раза и без дымного хвоста)
   * и несёт пять своих правил-«лазеров»: четыре с одним листом — длинная
   * красная линия с эмиссией 111 (у штатного следа 15) — и красная кайма с
   * белой нитью. В игре следы рисует слот Astral своим листом; размеры
   * переведены в метры слота (`tracerShape`). Шанс у «Тонкого луча» — как у
   * штатного следа: пак `weapons.meta` не трогает; «лазеры» в паке ни к
   * одному стволу не привязаны, здесь они — на каждом выстреле.
   */
  Object.freeze({
    id: "thin-beam",
    label: "Тонкий луч",
    description:
      "Только след: тонкая бело-голубая нить без дымного хвоста — длиннее штатного.",
    accent: "#b7d3e9",
    spec: spec({
      name: "Тонкий луч",
      tracer: {
        style: "beam",
        colour: "#b7d3e9",
        coreColour: "#ffffff",
        thickness: 0.1,
        length: 0.45,
        glow: 0.6,
        chanceSP: 0.2,
        chanceMP: 0.75,
      },
      impact: { enabled: false },
    }),
  }),
  Object.freeze({
    id: "laser-red",
    label: "Красный лазер",
    description: "Только след: длинная яркая красная линия на каждом выстреле.",
    accent: "#ff1a1a",
    spec: spec({
      name: "Красный лазер",
      tracer: {
        style: "beam",
        colour: "#ff1a1a",
        coreColour: "#ff7a7a",
        thickness: 0.3,
        length: 0.86,
        glow: 1,
        chanceSP: 1,
        chanceMP: 1,
      },
      impact: { enabled: false },
    }),
  }),
  Object.freeze({
    id: "red-core",
    label: "Красный с белым",
    description: "Только след: белая нить в красной кайме на каждом выстреле.",
    accent: "#ff3b3b",
    spec: spec({
      name: "Красный с белым",
      tracer: {
        style: "beam",
        colour: "#ff2020",
        coreColour: "#ffffff",
        thickness: 0.18,
        length: 0.45,
        glow: 0.9,
        chanceSP: 1,
        chanceMP: 1,
      },
      impact: { enabled: false },
    }),
  }),
  Object.freeze({
    id: "acid",
    label: "Кислота",
    description: "Зелёная кровь и ядовитый след.",
    accent: "#84cc16",
    spec: spec({
      name: "Кислота",
      tracer: {
        enabled: true,
        style: "plasma",
        colour: "#84cc16",
        coreColour: "#f7fee7",
        thickness: 0.5,
        length: 0.65,
        glow: 0.75,
        chanceSP: 1,
        chanceMP: 1,
      },
      impact: { enabled: true },
      zones: blood("#65a30d", 0.6),
    }),
  }),
  Object.freeze({
    id: "oil",
    label: "Машинное масло",
    description: "Чёрная жидкость по телу и искры от попадания в голову.",
    accent: "#94a3b8",
    spec: spec({
      name: "Машинное масло",
      tracer: {
        enabled: true,
        style: "beam",
        colour: "#e2e8f0",
        coreColour: "#ffffff",
        thickness: 0.2,
        length: 0.75,
        glow: 0.6,
        chanceSP: 0.8,
        chanceMP: 0.9,
      },
      impact: { enabled: true },
      zones: {
        head: zone([{ kind: "template", template: "sparks" }]),
        body: zone([{ kind: "blood", colour: "#111827", amount: 0.55 }]),
      },
    }),
  }),
  /* Дальше — пресеты одних попаданий: след пули они не трогают. */
  Object.freeze({
    id: "white-blood",
    label: "Белая кровь",
    description: "Светлые брызги умеренной силы — видно попадание, не мешает.",
    accent: "#e2e8f0",
    spec: spec({
      name: "Белая кровь",
      impact: { enabled: true },
      zones: blood("#e2e8f0", 0.45),
    }),
  }),
  Object.freeze({
    id: "blue-blood",
    label: "Синяя кровь",
    description: "Холодные голубые брызги.",
    accent: "#38bdf8",
    spec: spec({
      name: "Синяя кровь",
      impact: { enabled: true },
      zones: blood("#38bdf8", 0.55),
    }),
  }),
  Object.freeze({
    id: "sparks",
    label: "Искры",
    description: "Снопы искр вместо крови — как по металлу.",
    accent: "#ffb347",
    spec: spec({
      name: "Искры",
      impact: { enabled: true },
      zones: both({ kind: "template", template: "sparks" }, { amount: 0.65 }),
    }),
  }),
  Object.freeze({
    id: "lightning",
    label: "Молния",
    description: "Электрический разряд в голову и дуги по телу.",
    accent: "#7dd3fc",
    spec: spec({
      name: "Молния",
      impact: { enabled: true },
      zones: {
        head: zone([{ kind: "template", template: "electric-burst" }]),
        body: zone([{ kind: "template", template: "electric" }]),
      },
    }),
  }),
  Object.freeze({
    id: "money",
    label: "Деньги",
    description: "Из цели летят купюры, из головы — монеты.",
    accent: "#6ee787",
    spec: spec({
      name: "Деньги",
      impact: { enabled: true },
      zones: {
        head: zone([{ kind: "template", template: "coins" }]),
        body: zone([{ kind: "template", template: "money" }]),
      },
    }),
  }),
  Object.freeze({
    id: "water",
    label: "Вода",
    description: "Всплески воды от каждого попадания.",
    accent: "#bfe3ff",
    spec: spec({
      name: "Вода",
      impact: { enabled: true },
      zones: both({ kind: "template", template: "water" }, { amount: 0.65 }),
    }),
  }),
  Object.freeze({
    id: "hearts",
    label: "Сердечки",
    description: "Розовые сердца всплывают в точке попадания.",
    accent: "#fb7185",
    spec: spec({
      name: "Сердечки",
      impact: { enabled: true },
      zones: both(
        {
          kind: "custom",
          picture: "heart",
          tinted: true,
          colour: "#fb7185",
          amount: 0.4,
        },
        { amount: 0.55, count: 1 },
      ),
    }),
  }),
  Object.freeze({
    id: "crosses",
    label: "Крестики",
    description: "Белые крестики по телу и красный — в голову.",
    accent: "#f8fafc",
    spec: spec({
      name: "Крестики",
      impact: { enabled: true },
      zones: {
        head: zone([
          {
            kind: "custom",
            picture: "cross",
            tinted: true,
            colour: "#ef4444",
            amount: 0.5,
            count: 1,
          },
        ]),
        body: zone([
          {
            kind: "custom",
            picture: "cross",
            tinted: true,
            colour: "#f8fafc",
            amount: 0.35,
            count: 1,
          },
        ]),
      },
    }),
  }),
  Object.freeze({
    id: "clean",
    label: "Чистый кадр",
    description:
      "Без эффектов и пятен — ничто не закрывает цель в перестрелке.",
    accent: "#64748b",
    spec: spec({
      name: "Чистый кадр",
      impact: { enabled: true },
      /* Зона без слоёв и есть «без эффекта»: ни частиц, ни пятен. */
      zones: { head: zone([]), body: zone([]) },
    }),
  }),

  /*
   * Составные: из одной раны два и три слоя разом. Ради них всё и затевалось —
   * до слоёв такое нельзя было собрать вовсе, и человек, открывший редактор,
   * не догадывался, что так бывает.
   */
  Object.freeze({
    id: "romance",
    label: "Кровь и сердечки",
    description: "Тёмная кровь, а из головы вдобавок вылетают сердца.",
    accent: "#fb7185",
    spec: spec({
      name: "Кровь и сердечки",
      impact: { enabled: true },
      zones: {
        head: zone([
          { kind: "blood", colour: "#8f1111", amount: 0.6 },
          {
            kind: "custom",
            picture: "heart",
            tinted: true,
            colour: "#fb7185",
            amount: 0.42,
            count: 3,
          },
        ]),
        body: zone([
          { kind: "blood", colour: "#8f1111", amount: 0.5 },
          {
            kind: "custom",
            picture: "heart",
            tinted: true,
            colour: "#fb7185",
            amount: 0.3,
            count: 1,
          },
        ]),
      },
    }),
  }),
  Object.freeze({
    id: "cyber",
    label: "Синтетика",
    description: "Голубая кровь с искрами и разрядом в голову.",
    accent: "#38bdf8",
    /* Сторона правила вмещает семь эмиттеров (восьмой ронял игру): кровь
       поменьше и разряд — спереди, искры головы — из выходного отверстия.
       До 05.10.2026 голова несла 13, тело — 9. */
    spec: spec({
      name: "Синтетика",
      impact: { enabled: true },
      zones: {
        head: zone([
          {
            kind: "blood",
            variant: "small",
            colour: "#38bdf8",
            amount: 0.6,
            sheet: "shards",
          },
          { kind: "template", template: "electric-burst", amount: 0.4 },
          {
            kind: "template",
            template: "sparks",
            placement: "back",
            amount: 0.45,
          },
        ]),
        body: zone([
          {
            kind: "blood",
            variant: "small",
            colour: "#38bdf8",
            amount: 0.5,
            sheet: "shards",
          },
          { kind: "template", template: "sparks", amount: 0.35 },
        ]),
      },
    }),
  }),
  Object.freeze({
    id: "jackpot",
    label: "Джекпот",
    description: "Кровь купюрами, а сверху ещё и монеты.",
    accent: "#6ee787",
    spec: spec({
      name: "Джекпот",
      impact: { enabled: true },
      zones: {
        /* Семь эмиттеров на сторону: монеты летят из выходного отверстия
           (до 05.10.2026 спереди было восемь). */
        head: zone([
          { kind: "blood", colour: "#4ade80", amount: 0.55, sheet: "dollar" },
          { kind: "template", template: "money", amount: 0.6 },
          {
            kind: "template",
            template: "coins",
            placement: "back",
            amount: 0.45,
          },
        ]),
        body: zone([
          { kind: "blood", colour: "#4ade80", amount: 0.45, sheet: "dollar" },
          { kind: "template", template: "money", amount: 0.5 },
        ]),
      },
    }),
  }),
  Object.freeze({
    id: "sniper-duel",
    label: "Снайперская дуэль",
    description:
      "Вблизи брызги скромные, издалека — огромные и видно их за полкилометра.",
    accent: "#b01212",
    spec: spec({
      name: "Снайперская дуэль",
      impact: { enabled: true },
      zones: {
        head: zone([{ kind: "blood", colour: "#8f1111", amount: 0.7 }], {
          distance: { near: 0.6, far: 2.4, reach: 500 },
        }),
        body: zone([{ kind: "blood", colour: "#8f1111", amount: 0.55 }], {
          distance: { near: 0.6, far: 2.2, reach: 500 },
        }),
      },
    }),
  }),
  Object.freeze({
    id: "petals",
    label: "Лепестки",
    description: "Вместо капель — цветы, сверху облако розовой дымки.",
    accent: "#f9a8d4",
    spec: spec({
      name: "Лепестки",
      impact: { enabled: true },
      zones: both(
        {
          kind: "blood",
          colour: "#f9a8d4",
          amount: 0.55,
          sheet: "flower",
        },
        { amount: 0.7 },
      ),
    }),
  }),
  /*
   * Из чужих паков — как они собраны на самом деле. Majestic: спереди
   * снайперская кровь с лентой-кляксой, сзади (из спины) клоунские звёзды и
   * дым в тело и цветы с лентами в голову. Дымка — облако своим цветом.
   * Светящаяся кровь — маленькая, с кадрами эмиссии. Радуга — «RGB».
   */
  Object.freeze({
    id: "majestic-pink",
    label: "Majestic розовый",
    description:
      "Розовая кровь с лентой спереди; из спины — звёзды и дым, из головы — цветы.",
    accent: "#f472b6",
    spec: spec({
      name: "Majestic розовый",
      impact: { enabled: true },
      zones: {
        head: zone([
          { kind: "blood", variant: "line", colour: "#ff5fb4", amount: 0.6 },
          {
            kind: "template",
            template: "clown-bullet",
            placement: "back",
            amount: 0.55,
          },
        ]),
        body: zone([
          { kind: "blood", variant: "line", colour: "#ff5fb4", amount: 0.55 },
          {
            kind: "template",
            template: "clown-muzzle",
            placement: "back",
            amount: 0.5,
          },
        ]),
      },
    }),
  }),
  Object.freeze({
    id: "majestic-black",
    label: "Majestic чёрный",
    description: "Чёрная кровь с лентой, а из спины — клоунские звёзды и дым.",
    accent: "#111827",
    spec: spec({
      name: "Majestic чёрный",
      impact: { enabled: true },
      zones: {
        head: zone([
          { kind: "blood", variant: "line", colour: "#111111", amount: 0.6 },
          {
            kind: "template",
            template: "clown-bullet",
            placement: "back",
            tinted: true,
            colour: "#f1f5f9",
            amount: 0.55,
          },
        ]),
        body: zone([
          { kind: "blood", variant: "line", colour: "#111111", amount: 0.55 },
          {
            kind: "template",
            template: "clown-muzzle",
            placement: "back",
            tinted: true,
            colour: "#111111",
            amount: 0.5,
          },
        ]),
      },
    }),
  }),
  Object.freeze({
    id: "haze",
    label: "Дымка",
    description: "Мягкое облако своим цветом вместо брызг — смените цвет.",
    accent: "#f9a8d4",
    spec: spec({
      name: "Дымка",
      impact: { enabled: true },
      zones: both(
        { kind: "blood", variant: "mist", colour: "#f9a8d4", amount: 0.7 },
        { amount: 0.8 },
      ),
    }),
  }),
  Object.freeze({
    id: "glow-blood",
    label: "Светящаяся кровь",
    description: "Маленькие брызги, которые светят сами — и ночью тоже.",
    accent: "#ff3b3b",
    spec: spec({
      name: "Светящаяся кровь",
      impact: { enabled: true },
      zones: both(
        {
          kind: "blood",
          variant: "small",
          colour: "#ff3b3b",
          glow: true,
          amount: 0.55,
        },
        { amount: 0.65 },
      ),
    }),
  }),
  Object.freeze({
    id: "rainbow",
    label: "Радуга",
    description: "Кровь, которая переливается всеми цветами за свою жизнь.",
    accent: "#a855f7",
    spec: spec({
      name: "Радуга",
      impact: { enabled: true },
      zones: both(
        { kind: "blood", colour: "#ff3b3b", colourMode: "rainbow", amount: 0.6 },
        { amount: 0.7 },
      ),
    }),
  }),
  Object.freeze({
    id: "clown",
    label: "Клоун",
    description: "Цветы, звёзды и ленты из любой раны — без крови.",
    accent: "#f9a8d4",
    spec: spec({
      name: "Клоун",
      impact: { enabled: true },
      zones: both({ kind: "template", template: "clown-bullet", amount: 0.5 }),
    }),
  }),
  /*
   * Пак «Новые эффекты» (ТЗ 10.10.2026, задача 13): любое попадание — и в
   * рану, и из спины — играет одно свечение клоунской пули голубым, крови
   * нет вовсе. Одинаковые стопки спереди и сзади, в голове и в теле — одно
   * правило в ядре.
   */
  Object.freeze({
    id: "blue-glow",
    label: "Голубое свечение",
    description:
      "Вместо крови — голубой светящийся ореол из раны и из спины, без брызг и пятен.",
    accent: "#9dcbd9",
    spec: spec({
      name: "Голубое свечение",
      impact: { enabled: true },
      zones: bothSides({
        kind: "template",
        template: "clown-glow",
        tinted: true,
        colour: "#9dcbd9",
      }),
    }),
  }),
  Object.freeze({
    id: "inferno",
    label: "Пламя",
    description: "Огонь с чёрным дымом из головы, струя пламени по телу.",
    accent: "#f97316",
    spec: spec({
      name: "Пламя",
      impact: { enabled: true },
      zones: {
        head: zone([
          { kind: "template", template: "fire", amount: 0.5 },
          { kind: "template", template: "smoke-dark", amount: 0.5 },
        ]),
        body: zone([{ kind: "template", template: "flame-jet", amount: 0.45 }]),
      },
    }),
  }),
  Object.freeze({
    id: "storm",
    label: "Гроза",
    description: "Треск дуг в голову и синие молнии по телу — двух цветов.",
    accent: "#60a5fa",
    spec: spec({
      name: "Гроза",
      impact: { enabled: true },
      zones: {
        head: zone([
          {
            kind: "template",
            template: "crackle",
            tinted: true,
            colour: "#93c5fd",
            colourMode: "duo",
            colour2: "#f8fafc",
            amount: 0.55,
          },
        ]),
        body: zone([
          {
            kind: "template",
            template: "electric",
            tinted: true,
            colour: "#3b82f6",
            amount: 0.5,
          },
        ]),
      },
    }),
  }),
  Object.freeze({
    id: "smoke-steam",
    label: "Дым и пар",
    description: "Облако дымки из головы, тёмный дым и пар из тела.",
    accent: "#e0f2fe",
    spec: spec({
      name: "Дым и пар",
      impact: { enabled: true },
      zones: {
        head: zone([{ kind: "template", template: "haze", amount: 0.5 }]),
        body: zone([
          { kind: "template", template: "smoke-dark", amount: 0.5 },
          { kind: "template", template: "steam", amount: 0.45 },
        ]),
      },
    }),
  }),

  /*
   * Огонь и взрывы: готовый вид правит штатные листы ядра (`environment`),
   * а не правила. Оба — из пака «Новые эффекты» (ТЗ 10.10.2026, задача 13):
   *  • лист свечения `ptfx_glow_rgb` в паке — фиолетовые кольца вместо
   *    мягких серых ореолов, а рисуют его больше ста эффектов игры: огонь,
   *    искры, электричество, вспышки. Рисунок пака — переделка листа
   *    Rockstar и в поставку не идёт; здесь на лист игрока ложится тот же
   *    тон (средний цвет светящихся пикселей листа пака — 74, 32, 86);
   *  • семь листов дыма из девяти, весь пар, искры и зарево взрывов пак
   *    стирает до прозрачных 4×4. Плотности ниже 20 % редактор не даёт:
   *    здесь они «почти прозрачные», а не стёртые.
   */
  Object.freeze({
    id: "violet-glow",
    label: "Фиолетовое свечение",
    description: "Ореолы огня, искр, электричества и вспышек — фиолетовые.",
    accent: "#c45cff",
    spec: spec({
      name: "Фиолетовое свечение",
      environment: {
        glow: {
          enabled: true,
          tint: "#c45cff",
          tintStrength: 0.9,
          brightness: 1,
          opacity: 1,
        },
      },
    }),
  }),
  Object.freeze({
    id: "clean-screen",
    label: "Чистый экран",
    description:
      "Дым, пар, искры и зарево взрывов почти прозрачны — ничто не закрывает цель.",
    accent: "#94a3b8",
    spec: spec({
      name: "Чистый экран",
      environment: {
        smoke: thinned,
        steam: thinned,
        sparks: thinned,
        "explosion-glow": thinned,
      },
    }),
  }),
]);

/*
 * Что пресет даёт каталогу, без сборки проекта. Трассер пресета едет на всё
 * оружие (`presets.js`), поэтому пресет со следом — это пресет с заказом
 * следа; попадания — включённые в заказе. Тест сверяет оба ответа с
 * собранными проектами.
 */
export const presetHasTracer = (preset) => Boolean(preset?.spec?.tracer);
export const presetHasImpact = (preset) => preset?.spec?.impact?.enabled === true;
