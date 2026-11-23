/*
 * «Дирижабли» — что летает в небе над штатом (ТЗ 11.10.2026: «чтобы люди
 * могли редактировать этот дирижабль и чтобы он отображался на РП проектах,
 * сделай готовые модельки дракона, воздушных шаров и т. д. и чтобы люди
 * могли выбирать количество их в небе»).
 *
 * Работа человека:
 *
 *   • облик дирижабля игры — лист `blimp_sign_1` (512 × 256): он один
 *     обтягивает всю оболочку штатного `blimp` (синий фон «Atomic», логотип
 *     на обоих бортах, жёлтые полосы внизу) и светится ночью вторым
 *     шейдером модели. Своя надпись или картинка, цвет оболочки и полос —
 *     новый лист той же разметки (`paintAirshipSign`); «как в игре» — лист
 *     игрока без правки;
 *   • штатный дирижабль игры (машина `blimp`) — по желанию тем же листом:
 *     его словарь едет копией с новым листом (`game`);
 *   • флот — сколько чего летает: дирижабли (модель игры игрока с листом
 *     работы), драконы, фениксы, воздушные шары, небесные фонарики, НЛО,
 *     киты, медузы, самолёты с баннером, восточные драконы и грифоны; у
 *     каждого — свои цвета и свой размер, а у своих моделей ещё лого и
 *     своя текстура (ТЗ 11.10.2026, вечер; `decal`, `skin`, `size`).
 *     Свои модели рисует Astral
 *     (`airship-models.js`, крылья и огонь у них живые): моделей и текстур
 *     Rockstar в поставке нет;
 *   • где летают, как высоко над крышами, как быстро и с какого расстояния
 *     видно.
 *
 * Как это попадает в игру. Летающий — «анимированная постройка» игры: своя
 * модель со скелетом и клип полёта (`compile-sky-flyer`), архетип с флагами
 * 0x80200 и словарём клипов, сущность в своей карте (`compile-placements`)
 * — так же, как «Летающее лого». Это файлы карты, а не скрипт: их грузит и
 * одиночная игра, и клиент РП-сервера (Majestic, GTA5RP и др.) — скриптов
 * там не запустить, а карта игры у всех своя, с диска.
 *
 * Путь — круг над центром сущности: место и поворот кости по кадрам
 * (`airshipFlight`), крен в повороте, плавный подъём и спуск. Все копии
 * одного вида летят одним клипом, но у каждой свой центр круга, своя
 * высота и свой поворот круга — в небе они в разных местах круга.
 * Высота считается над НАИБОЛЬШЕЙ высотой карты под всем кругом (крыши,
 * кроны, горы — `inventory/airship-sky.js`): дирижабль не проходит сквозь
 * «Мейз-банк», дракон — сквозь Чилиад.
 *
 * Чистые функции без Node и DOM: их читают окно, главный процесс и тесты.
 */

import { hexBytes, normalizeRecolourHex } from "./colour.js";
import { EMBLEM_ASSET, EMBLEM_FONT_ASSET, emblemTextFilled, normalizeEmblemText } from "./emblems.js";
import { AIRSHIP_SKY } from "./inventory/airship-sky.js";

export const AIRSHIPS_SCHEMA = 1;
export const AIRSHIPS_SET = "airships";
export const AIRSHIPS_SLOT = "airships";
const NAME_LIMIT = 60;

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
function clamp(value, [low, high], fallback, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const factor = 10 ** digits;
  return Math.round(Math.min(high, Math.max(low, number)) * factor) / factor;
}

/* ------------------------------------------------------------------ *
 * Виды летающих
 * ------------------------------------------------------------------ */

/*
 * Вид: `max` — сколько их бывает в небе разом; полёт — радиус круга
 * (`radius`, м), скорость (`speed`, м/с при «Скорости» ×1), крен в
 * повороте (`bank`, °), подъём-спуск (`bob`, м, `waves` раз за круг),
 * своё вращение (`spin`, оборотов за круг — у НЛО), смотрит ли модель по
 * ходу (`heading`). `lift` — на сколько выше крыш под кругом он летит
 * при «Высоте» 0 (фонарики — низко, дирижабль — как в игре). `length` —
 * длина модели при размере 100 %, м. `reach` — во сколько раз дальше
 * «Видно с расстояния» его видно: огонь шара и свет медузы, феникса и НЛО
 * заметны издалека (ТЗ 11.10.2026, вечер, задача 3: «чтобы огонь издалека
 * был виден»).
 *
 * Феникс, медуза и самолёт с баннером — виды того же вечера: «там ещё
 * какие-то можешь добавить виды»; восточный дракон и грифон — ночи того же
 * дня (задача 3).
 */
export const AIRSHIP_KINDS = Object.freeze([
  kind("blimp", "Дирижабль", "Дирижабль игры с вашей надписью и цветами", {
    max: 6, count: 1, radius: 420, speed: 9, bank: 3, bob: 4, waves: 2, lift: 110, length: 58,
  }),
  kind("dragon", "Дракон", "Машет крыльями, глаза горят", {
    max: 8, radius: 260, speed: 15, bank: 16, bob: 8, waves: 3, lift: 70, length: 25,
  }),
  kind("phoenix", "Феникс", "Огненная птица: светится и машет крыльями", {
    max: 6, radius: 280, speed: 17, bank: 18, bob: 9, waves: 3, lift: 90, length: 18, reach: 1.25,
  }),
  kind("balloon", "Воздушный шар", "Дрейфует, огонь горелки видно издалека", {
    max: 16, radius: 170, speed: 3, bank: 0, bob: 5, waves: 2, lift: 60, length: 22, heading: false, reach: 1.5,
  }),
  kind("lantern", "Небесные фонарики", "Рой светящихся фонариков, пламя мерцает", {
    max: 40, radius: 45, speed: 1.6, bank: 0, bob: 3, waves: 2, lift: 25, length: 3, heading: false,
  }),
  kind("ufo", "НЛО", "Тарелка с бегущими огнями и светом снизу", {
    max: 6, radius: 230, speed: 22, bank: 7, bob: 9, waves: 4, lift: 120, length: 25, spin: 6, reach: 1.25,
  }),
  kind("whale", "Небесный кит", "Плывёт, бьёт хвостом, пятна светятся", {
    max: 4, radius: 330, speed: 7, bank: 6, bob: 12, waves: 2, lift: 140, length: 32,
  }),
  kind("jellyfish", "Медуза", "Светится, купол дышит, щупальца колышутся", {
    max: 10, radius: 120, speed: 2.2, bank: 0, bob: 7, waves: 2, lift: 80, length: 18, heading: false, reach: 1.25,
  }),
  kind("banner", "Самолёт с баннером", "Биплан тянет полотнище с вашим лого", {
    max: 4, radius: 420, speed: 30, bank: 12, bob: 5, waves: 2, lift: 100, length: 41,
  }),
  /* Ночь того же дня, задача 3: «восточный дракон» и «грифон». В конце
     списка: расстановка идёт по порядку видов, небо прежних работ не
     сдвигается. */
  kind("eastern_dragon", "Восточный дракон", "Змеем вьётся по небу: грива, усы, рога, без крыльев", {
    max: 6, radius: 280, speed: 14, bank: 12, bob: 10, waves: 3, lift: 80, length: 32,
  }),
  kind("griffin", "Грифон", "Лев с головой и крыльями орла, машет крыльями", {
    max: 8, radius: 220, speed: 16, bank: 18, bob: 7, waves: 3, lift: 60, length: 13,
  }),
]);

function kind(id, label, description, values) {
  return Object.freeze({ id, label, description, count: 0, heading: true, spin: 0, reach: 1, ...values });
}

export const AIRSHIP_KIND_IDS = Object.freeze(AIRSHIP_KINDS.map((item) => item.id));
export const airshipKind = (id) => AIRSHIP_KINDS.find((item) => item.id === id) || null;

/* Узоры оболочки воздушного шара. */
export const BALLOON_PATTERNS = Object.freeze(["stripes", "rings", "checks", "spiral"]);
export const BALLOON_PATTERN_LABELS = Object.freeze({
  stripes: "Клинья",
  rings: "Пояса",
  checks: "Шахматы",
  spiral: "Спираль",
});

/* Цвета видов по умолчанию: работа хранит только эти поля. */
const KIND_COLOURS = Object.freeze({
  blimp: Object.freeze({}),
  dragon: Object.freeze({ colour: "#2f7d4a", belly: "#e3c46a", wings: "#7d2430", eyes: "#ff6a1a" }),
  phoenix: Object.freeze({ colour: "#d9361c", wings: "#ff8a1f", flame: "#ffd23a" }),
  balloon: Object.freeze({ colours: Object.freeze(["#e8333a", "#ffd23a", "#2e6fe0"]), pattern: "stripes" }),
  lantern: Object.freeze({ colour: "#ffa43a" }),
  ufo: Object.freeze({ colour: "#9aa5b4", lights: "#39ff8a" }),
  whale: Object.freeze({ colour: "#2f5f9e", belly: "#dbe7f2", spots: "#5cf2ff" }),
  jellyfish: Object.freeze({ colour: "#8a5cff", tentacles: "#ff7ad9", glow: "#7af7ff" }),
  banner: Object.freeze({ colour: "#c8302a", wings: "#f2e6c9", banner: "#ffffff" }),
  eastern_dragon: Object.freeze({ colour: "#1e7a5f", belly: "#f2c650", mane: "#e8432e", eyes: "#ffe14a" }),
  griffin: Object.freeze({ colour: "#b9873f", wings: "#5b3c24", head: "#f1ede2", beak: "#f2b632" }),
});

/*
 * Лого по умолчанию: полотнище самолёта без слов пустое — на нём надпись
 * работы по умолчанию (как у дирижабля); у остальных — без лого. Явный
 * выбор человека («Без лого») хранится в работе и остаётся.
 */
const decalDefault = (id) => (id === "banner" ? { mode: "text", text: { value: AIRSHIP_DEFAULT_TEXT, font: "wide", colour: "#c8302a", outline: "none" } } : undefined);

/*
 * Размер — у каждого вида свой (ТЗ 11.10.2026, вечер, задача 3: «цвет
 * настраивает, размеры»): работы до этого хранили один размер на всё небо
 * (`size` работы) — он становится размером каждого вида, у которого своего
 * ещё нет.
 */
function normalizeFleetItem(id, input, legacySize) {
  const source = plain(input);
  const info = airshipKind(id);
  const colours = KIND_COLOURS[id];
  const item = { count: clamp(source.count, [0, info.max], info.count), size: clamp(source.size ?? legacySize, AIRSHIP_LIMITS.size, 100) };
  for (const [key, fallback] of Object.entries(colours)) {
    if (key === "colours") {
      const list = Array.isArray(source.colours) ? source.colours : [];
      item.colours = fallback.map((value, index) => normalizeRecolourHex(list[index], value));
    } else if (key === "pattern") item.pattern = BALLOON_PATTERNS.includes(source.pattern) ? source.pattern : fallback;
    else item[key] = normalizeRecolourHex(source[key], fallback);
  }
  /* Свои модели — ещё лого и своя текстура (дирижабль — инструментом «Дирижабль»). */
  if (id !== "blimp") {
    item.decal = normalizeDecal(source.decal ?? decalDefault(id));
    item.skin = normalizeSkin(source.skin);
  }
  return item;
}

/* ------------------------------------------------------------------ *
 * Лого и своя текстура на своих моделях
 * ------------------------------------------------------------------ */

/*
 * ТЗ 11.10.2026, вечер: «добавь функционал, чтобы они могли добавлять лого
 * на штуку, или покрасить в свой цвет, загрузить свою текстуру, может,
 * дорисовать что-то». У каждой своей модели (дракон, шар, фонарик, НЛО,
 * кит):
 *
 *   • лого — надпись общей системой надписей или картинка (своя или
 *     нарисованная в окне): на крыльях дракона, на двух боках шара, на
 *     четырёх сторонах фонарика, на кольце тарелки сверху и снизу, на
 *     боках кита (места — `airshipSkinLayout`);
 *   • своя текстура — картинка (своя или нарисованная), которая обтягивает
 *     главное тело: спину и бока дракона и кита, оболочку шара, бумагу
 *     фонарика, корпус тарелки.
 *
 * Картинки живут в хранилище окна (`hangar-emblem:<sha>`); в работе — ключ,
 * имя и размер. Лист модели с ними рисует договор (`paintAirshipSkin`) —
 * один для кадра окна и для установщика.
 */
export const AIRSHIP_DECAL_MODES = Object.freeze(["none", "text", "image"]);
export const AIRSHIP_DECAL_LABELS = Object.freeze({ none: "Без лого", text: "Надпись", image: "Картинка" });
export const AIRSHIP_SKIN_MODES = Object.freeze(["none", "image"]);
export const AIRSHIP_SKIN_LABELS = Object.freeze({ none: "Цветами модели", image: "Своя картинка" });
/* Размер лого — доля места на модели, %. */
export const AIRSHIP_DECAL_SIZE = Object.freeze([30, 100]);
const DECAL_TEXT = Object.freeze({ value: "", font: "wide", colour: "#ffffff", outline: "dark" });

function normalizeDecal(input) {
  const source = plain(input);
  const image = normalizeImage(source.image);
  let mode = AIRSHIP_DECAL_MODES.includes(source.mode) ? source.mode : "none";
  if (mode === "image" && !image) mode = "none";
  return { mode, text: normalizeEmblemText({ ...DECAL_TEXT, ...plain(source.text) }), image, size: clamp(source.size, AIRSHIP_DECAL_SIZE, 80) };
}

function normalizeSkin(input) {
  const source = plain(input);
  const image = normalizeImage(source.image);
  return { mode: source.mode === "image" && image ? "image" : "none", image };
}

/** Есть ли у вида лого, которое рисуется: надпись со словами или картинка. */
export const airshipDecalReady = (item) => (item?.decal?.mode === "text" ? emblemTextFilled(item.decal.text) : item?.decal?.mode === "image" && Boolean(item.decal.image?.asset));
/** Есть ли у вида своя текстура. */
export const airshipSkinReady = (item) => item?.skin?.mode === "image" && Boolean(item.skin.image?.asset);

/** Нужен ли модели вида лист картинки (лого или своя текстура). Дирижабль — нет: у него лист надписи. */
export function airshipDecorated(kindId, input) {
  if (kindId === "blimp") return false;
  const item = normalizeAirshipsProject(input).fleet[kindId];
  return Boolean(item) && (airshipDecalReady(item) || airshipSkinReady(item));
}

/* ------------------------------------------------------------------ *
 * Где летают
 * ------------------------------------------------------------------ */

/* Прямоугольники центров кругов в координатах игры: x от запада, y от юга. */
export const AIRSHIP_AREAS = Object.freeze([
  area("city", "Над Лос-Сантосом", "Весь город: от аэропорта и порта до Вайнвуда", [-1750, -2350, 1250, 350]),
  area("downtown", "Над центром", "Небоскрёбы делового центра, площадь Легиона", [-900, -1300, 400, -300]),
  area("vinewood", "Над Вайнвудом", "Холмы, надпись, обсерватория", [-800, 0, 1000, 1300]),
  area("coast", "Над побережьем", "Веспуччи, Дель-Перро, пирс и пляжи", [-2300, -1900, -1000, -300]),
  area("island", "Над всем штатом", "Город, пустыня, Сэнди-Шорс, Палето-Бэй и горы", [-3000, -3200, 3600, 7200]),
]);

function area(id, label, description, box) {
  return Object.freeze({ id, label, description, box: Object.freeze(box) });
}

export const airshipArea = (id) => AIRSHIP_AREAS.find((item) => item.id === id) || AIRSHIP_AREAS[0];

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

/* Надпись дирижабля: как в игре (лист игрока), своя надпись, своя картинка, без надписи. */
export const AIRSHIP_SIGN_MODES = Object.freeze(["game", "text", "image", "none"]);
export const AIRSHIP_SIGN_LABELS = Object.freeze({ game: "Как в игре", text: "Надпись", image: "Картинка", none: "Без надписи" });
/* Цвета листа игры (замер по `blimp_sign_1` Legacy, 11.10.2026). */
export const AIRSHIP_GAME_COLOURS = Object.freeze({ body: "#0055a0", stripe: "#ffdf00" });
export const AIRSHIP_TAGLINE_LIMIT = 40;

export const AIRSHIP_LIMITS = Object.freeze({
  altitude: Object.freeze([0, 400]),
  speed: Object.freeze([0.25, 3]),
  size: Object.freeze([50, 200]),
  drawDistance: Object.freeze([800, 5000]),
});

function normalizeImage(input) {
  const source = plain(input);
  const asset = String(source.asset || "");
  if (!EMBLEM_ASSET.test(asset)) return null;
  return {
    asset,
    name: String(source.name || "").slice(0, 120),
    width: clamp(source.width, [1, 16384], 512),
    height: clamp(source.height, [1, 16384], 512),
  };
}

function cleanLine(value, limit) {
  return Array.from(String(value ?? ""))
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join("")
    .slice(0, limit);
}

/*
 * Надпись дирижабля по умолчанию (владелец, 11.10.2026: «поменяй весь
 * визуал: сделай надпись на дирижабле „Это всё о'кей“»). Шрифт «Широкий» —
 * Segoe UI Black окна: кириллица и апостроф у него есть (запасной — Arial
 * Black, тоже с кириллицей). Новая работа открывается этой надписью; у
 * сохранённых работ и кодов поля записаны явно (`sign`, `text`) и
 * открываются как были.
 */
export const AIRSHIP_DEFAULT_TEXT = "Это всё о’кей";

function normalizeBlimp(input) {
  const source = plain(input);
  const image = normalizeImage(source.image);
  const text = normalizeEmblemText({ value: AIRSHIP_DEFAULT_TEXT, font: "wide", colour: "#ffffff", outline: "dark", ...plain(source.text) });
  let sign = AIRSHIP_SIGN_MODES.includes(source.sign) ? source.sign : "text";
  if (sign === "image" && !image) sign = "none";
  return {
    sign,
    text,
    image,
    tagline: cleanLine(source.tagline, AIRSHIP_TAGLINE_LIMIT),
    body: normalizeRecolourHex(source.body, AIRSHIP_GAME_COLOURS.body),
    stripe: normalizeRecolourHex(source.stripe, AIRSHIP_GAME_COLOURS.stripe),
  };
}

export function createAirshipsProject() {
  return normalizeAirshipsProject({});
}

export function normalizeAirshipsProject(input) {
  const source = plain(input);
  const fleetSource = plain(source.fleet);
  const fleet = {};
  for (const id of AIRSHIP_KIND_IDS) fleet[id] = normalizeFleetItem(id, fleetSource[id], source.size);
  return {
    schema: AIRSHIPS_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    blimp: normalizeBlimp(source.blimp),
    /* Менять ли штатный дирижабль игры тем же листом. */
    game: source.game !== false,
    fleet,
    area: AIRSHIP_AREAS.some((item) => item.id === source.area) ? source.area : "city",
    altitude: clamp(source.altitude, AIRSHIP_LIMITS.altitude, 40),
    speed: clamp(source.speed, AIRSHIP_LIMITS.speed, 1, 2),
    drawDistance: clamp(source.drawDistance, AIRSHIP_LIMITS.drawDistance, 3000),
  };
}

export const serializeAirshipsProject = (project) => JSON.stringify(normalizeAirshipsProject(project));

export function parseAirshipsProject(text) {
  try {
    return normalizeAirshipsProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createAirshipsProject();
  }
}

/** Сколько летающих в небе всего. */
export const airshipCount = (input) => {
  const project = normalizeAirshipsProject(input);
  return AIRSHIP_KIND_IDS.reduce((sum, id) => sum + project.fleet[id].count, 0);
};

/** Меняется ли лист дирижабля (своя надпись, картинка или цвета). */
export const airshipSignChanged = (input) => normalizeAirshipsProject(input).blimp.sign !== "game";

/** Едет ли копия словаря штатного дирижабля игры. */
export const airshipGameRepainted = (input) => {
  const project = normalizeAirshipsProject(input);
  return project.game && project.blimp.sign !== "game";
};

/** Ставить нечего: лист как в игре и в небе пусто — «Стандарт», установка снимается. */
export const airshipsIsStock = (input) => !airshipGameRepainted(input) && airshipCount(input) === 0;

export function airshipsSignature(input) {
  const project = normalizeAirshipsProject(input);
  const { name: _name, schema: _schema, ...rest } = project;
  const blimp = project.blimp;
  /* Лого и текстура — только то, что рисуется: спрятанная надпись или картинка работу не меняют. */
  const fleet = {};
  for (const id of AIRSHIP_KIND_IDS) {
    const item = project.fleet[id];
    fleet[id] = item.decal
      ? {
          ...item,
          decal: airshipDecalReady(item) ? { ...item.decal, text: item.decal.mode === "text" ? item.decal.text : null, image: item.decal.mode === "image" ? item.decal.image : null } : null,
          skin: airshipSkinReady(item) ? item.skin.image : null,
        }
      : item;
  }
  return JSON.stringify({
    ...rest,
    fleet,
    blimp: {
      ...blimp,
      text: blimp.sign === "text" ? blimp.text : null,
      image: blimp.sign === "image" ? blimp.image : null,
      tagline: blimp.sign === "text" || blimp.sign === "image" ? blimp.tagline : "",
    },
  });
}

/** «Стандарт»: дирижабль как в игре, в небе пусто. */
export function applyAirshipsStandard(input) {
  const project = normalizeAirshipsProject(input);
  const fleet = {};
  for (const id of AIRSHIP_KIND_IDS) fleet[id] = { ...project.fleet[id], count: 0 };
  return normalizeAirshipsProject({ ...project, blimp: { ...project.blimp, sign: "game" }, fleet });
}
export const resetAirshipsProject = () => createAirshipsProject();

const withoutCustomFont = (text) => (text.font === "custom" ? normalizeEmblemText({ ...text, font: "block", fontAsset: "" }) : text);

/**
 * Свои картинки и свой шрифт в код не едут: картинка дирижабля — «без
 * надписи», лого-картинка и своя текстура моделей — «без лого» и цветами
 * модели, шрифт — рубленый.
 */
export function shareableAirshipsProject(input) {
  const project = normalizeAirshipsProject(input);
  const blimp = { ...project.blimp };
  if (blimp.sign === "image") blimp.sign = "none";
  blimp.image = null;
  blimp.text = withoutCustomFont(blimp.text);
  const fleet = {};
  for (const id of AIRSHIP_KIND_IDS) {
    const item = project.fleet[id];
    if (!item.decal) {
      fleet[id] = item;
      continue;
    }
    fleet[id] = {
      ...item,
      decal: { ...item.decal, mode: item.decal.mode === "image" ? "none" : item.decal.mode, image: null, text: withoutCustomFont(item.decal.text) },
      skin: { mode: "none", image: null },
    };
  }
  return normalizeAirshipsProject({ ...project, blimp, fleet });
}
export const airshipsLostInCode = (input) => {
  const project = normalizeAirshipsProject(input);
  const blimp = project.blimp;
  if (blimp.sign === "image" || (blimp.sign === "text" && EMBLEM_FONT_ASSET.test(blimp.text.fontAsset || ""))) return true;
  return AIRSHIP_KIND_IDS.some((id) => {
    const item = project.fleet[id];
    if (!item.decal) return false;
    return airshipSkinReady(item) || item.decal.mode === "image" || (item.decal.mode === "text" && EMBLEM_FONT_ASSET.test(item.decal.text.fontAsset || ""));
  });
};

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

/*
 * Шаблон задаёт состав неба (сколько чего) и, где нужно, высоту и место;
 * надпись и цвета дирижабля остаются вашими. Цвета видов — свои у
 * шаблона, если он о них («Огненные драконы»).
 */
const fleetOf = (counts, colours = {}) =>
  Object.fromEntries(AIRSHIP_KIND_IDS.map((id) => [id, { count: counts[id] || 0, ...(colours[id] || {}) }]));

export const AIRSHIP_PRESETS = Object.freeze([
  preset("one", "Дирижабль над городом", "Один дирижабль с вашей надписью — как в игре, только ваш.", { fleet: fleetOf({ blimp: 1 }), area: "city", altitude: 40 }),
  preset("parade", "Парад дирижаблей", "Четыре дирижабля над городом на разной высоте.", { fleet: fleetOf({ blimp: 4 }), area: "city", altitude: 60 }),
  preset("dragons", "Драконы над городом", "Четыре дракона кружат над небоскрёбами.", {
    fleet: fleetOf({ dragon: 4 }, { dragon: { colour: "#2f7d4a", belly: "#e3c46a", wings: "#7d2430", eyes: "#ff6a1a" } }),
    area: "downtown",
    altitude: 30,
  }),
  preset("fire", "Огненные драконы", "Красно-золотые драконы с горящими глазами.", {
    fleet: fleetOf({ dragon: 3 }, { dragon: { colour: "#a3161b", belly: "#ffb81f", wings: "#3b0b0e", eyes: "#ffe84a" } }),
    area: "city",
    altitude: 50,
  }),
  preset("balloons", "Фестиваль шаров", "Десять воздушных шаров над Вайнвудом.", { fleet: fleetOf({ balloon: 10 }), area: "vinewood", altitude: 20 }),
  preset("lanterns", "Ночь фонариков", "Тридцать небесных фонариков низко над крышами.", { fleet: fleetOf({ lantern: 30 }), area: "downtown", altitude: 0 }),
  preset("ufo", "Вторжение", "Четыре НЛО с зелёными огнями.", {
    fleet: fleetOf({ ufo: 4 }, { ufo: { colour: "#8f9aa8", lights: "#39ff8a" } }),
    area: "city",
    altitude: 60,
  }),
  preset("tale", "Сказка", "Киты, драконы и шары — небо из сна.", { fleet: fleetOf({ whale: 2, dragon: 2, balloon: 5, lantern: 12 }), area: "city", altitude: 40 }),
  preset("phoenix", "Фениксы", "Три огненные птицы над Вайнвудом — видно издалека.", { fleet: fleetOf({ phoenix: 3 }), area: "vinewood", altitude: 50 }),
  preset("jelly", "Небесные медузы", "Светящиеся медузы плывут над побережьем.", { fleet: fleetOf({ jellyfish: 6 }), area: "coast", altitude: 30 }),
  preset("banner", "Самолёт с баннером", "Биплан тянет полотнище с вашей надписью над пляжами.", { fleet: fleetOf({ banner: 2 }), area: "coast", altitude: 20 }),
  preset("legends", "Легенды", "Восточные драконы вьются, грифоны машут крыльями над Вайнвудом.", { fleet: fleetOf({ eastern_dragon: 2, griffin: 3 }), area: "vinewood", altitude: 40 }),
  preset("all", "Всё сразу", "По чуть-чуть всего: дирижабли, драконы, фениксы, шары, фонарики, НЛО, кит, медузы, самолёт, восточный дракон и грифон.", {
    fleet: fleetOf({ blimp: 2, dragon: 2, phoenix: 1, balloon: 4, lantern: 12, ufo: 1, whale: 1, jellyfish: 2, banner: 1, eastern_dragon: 1, griffin: 1 }),
    area: "island",
    altitude: 40,
  }),
]);

function preset(id, label, description, values) {
  return Object.freeze({ id, label, description, values: Object.freeze(values) });
}

export function applyAirshipsPreset(input, presetId) {
  const project = normalizeAirshipsProject(input);
  const found = AIRSHIP_PRESETS.find((item) => item.id === presetId);
  if (!found) return project;
  const fleet = {};
  for (const id of AIRSHIP_KIND_IDS) fleet[id] = { ...project.fleet[id], ...plain(found.values.fleet?.[id]) };
  return normalizeAirshipsProject({ ...project, ...found.values, fleet });
}

export function matchingAirshipsPreset(input) {
  const project = normalizeAirshipsProject(input);
  const key = airshipsSignature(project);
  return AIRSHIP_PRESETS.find((item) => airshipsSignature(applyAirshipsPreset(project, item.id)) === key)?.id || null;
}

/* ------------------------------------------------------------------ *
 * Дирижабль игры
 * ------------------------------------------------------------------ */

/*
 * Машина `blimp` игры: модель `blimp.yft`, её словарь `blimp.ytd` (лист
 * надписи `blimp_sign_1` и листы салона) и общий словарь машин `vehshare`
 * (гондола и моторы — `vehicle_generic_detail2`). Летающая копия и кадр
 * берут снаружи видное: оболочку (обе её сетки — освещённая и светящаяся
 * ночью — с листом надписи), гондолу с моторами и окна; салон, сиденья,
 * приборы, двери и колесо — нет: их с земли не видно.
 */
export const AIRSHIP_BLIMP = Object.freeze({
  model: "blimp",
  dictionary: "blimp",
  dictionaries: Object.freeze(["blimp", "vehshare"]),
  sheet: "blimp_sign_1",
  /* Где они у игры (опись Legacy, 11.10.2026): дирижабль — в основных
     машинах, общий словарь — свежий в пакете Rockstar, прежний — в основе. */
  addresses: Object.freeze({
    model: Object.freeze(["x64e.rpf:levels/gta5/vehicles.rpf/blimp.yft"]),
    dictionary: Object.freeze(["x64e.rpf:levels/gta5/vehicles.rpf/blimp.ytd"]),
    shared: Object.freeze([
      "update/x64/dlcpacks/patchdayg9ecng/dlc.rpf:x64/levels/gta5/vehicles.rpf/vehshare.ytd",
      "x64e.rpf:levels/gta5/vehicles.rpf/vehshare.ytd",
    ]),
  }),
});

/* Имена файлов работы: модель и клип вида, общие типы и карта. */
export const airshipModelName = (kindId) => `astral_sky_${kindId}`;
export const airshipClipsName = (kindId) => `astral_sky_${kindId}_clips`;
export const AIRSHIP_TYPES = "astral_sky_types";
export const AIRSHIP_MAP = "astral_sky_map";

/** Все файлы, что работа может везти (их же пускает доверие пакета мест). */
export function airshipFileNames() {
  return [
    `${AIRSHIP_BLIMP.dictionary}.ytd`,
    ...AIRSHIP_KIND_IDS.flatMap((id) => [`${airshipModelName(id)}.ydr`, `${airshipClipsName(id)}.ycd`]),
    `${AIRSHIP_TYPES}.ytyp`,
    `${AIRSHIP_MAP}.ymap`,
    "_manifest.ymf",
  ];
}

const BLIMP_PARTS = Object.freeze({
  blimp_sign_1: Object.freeze({ id: "sign" }),
  vehicle_generic_detail2: Object.freeze({ id: "detail" }),
  vehicle_generic_glasswindows2: Object.freeze({ id: "glass", alpha: "blend" }),
});

/** Часть дирижабля по листу сетки: `{ id, alpha? }` или `null` — сетка не берётся. */
export const airshipBlimpPart = (texture) => BLIMP_PARTS[String(texture || "").toLowerCase()] || null;

/* ------------------------------------------------------------------ *
 * Лист дирижабля
 * ------------------------------------------------------------------ */

/*
 * Разметка листа `blimp_sign_1` (512 × 256, замер 11.10.2026). Лист
 * обтягивает каждую половину оболочки: u — вдоль длины (на обоих бортах
 * надпись читается слева направо — развёртка правого борта отражена), v —
 * по обхвату сверху вниз. Логотип «Atomic» — в верхней части борта, под
 * ним строка «Tire and rubber products», ниже — толстая жёлтая полоса с
 * тенью и у самого низа — жёлтый пояс.
 *
 * Не весь лист — борт. Три пятна листа растянуты на большие куски оболочки
 * (плотность развёртки, замер 11.10.2026): середина логотипа (u 0,56…0,63,
 * v 0,31…0,44) обтягивает весь верх — около 700 м² (у игры там белый
 * пиксель буквы, и верх белый), угол u > 0,94, v < 0,19 — хвостовой конус,
 * низ пояса — полосу вдоль киля. Поэтому своя надпись стоит НЕ на месте
 * логотипа игры, а ниже — на экваторе и нижней половине борта (её и видно
 * с земли), строка — между полосой и поясом, а пятно верха закрашено
 * цветом оболочки: иначе верх брал бы случайную точку надписи.
 *
 * Доли — от ширины и высоты листа: так же ложатся и на копию крупнее.
 */
export const AIRSHIP_SIGN_SIZE = Object.freeze({ width: 512, height: 256 });
export const AIRSHIP_SIGN_LAYOUT = Object.freeze({
  /* Надпись или картинка — вписана с сохранением пропорций. */
  sign: Object.freeze([0.06, 0.45, 0.94, 0.735]),
  /* Строка под ней — между полосой и поясом. */
  tagline: Object.freeze([0.1, 0.81, 0.9, 0.935]),
  /* Пятно, натянутое на весь верх оболочки: [u0, v0, u1, v1] — цвет оболочки. */
  top: Object.freeze([0.555, 0.3, 0.635, 0.45]),
  /* Полосы: [v0, v1] — сама полоса, тень — тёмной линией под ней. */
  stripe: Object.freeze([0.746, 0.789]),
  stripeShadow: Object.freeze([0.789, 0.8]),
  band: Object.freeze([0.966, 1]),
  bandShadow: Object.freeze([0.95, 0.966]),
});

/* Наложение `src` (RGBA) поверх `dst` в прямоугольник [x0, y0, x1, y1] (доли), вписанно. */
function blendInto(dst, width, height, image, rect) {
  if (!image?.rgba || !image.width || !image.height) return;
  const [rx0, ry0, rx1, ry1] = rect;
  const boxW = (rx1 - rx0) * width;
  const boxH = (ry1 - ry0) * height;
  const scale = Math.min(boxW / image.width, boxH / image.height);
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const left = Math.round(rx0 * width + (boxW - w) / 2);
  const top = Math.round(ry0 * height + (boxH - h) / 2);
  for (let y = 0; y < h; y += 1) {
    const ty = top + y;
    if (ty < 0 || ty >= height) continue;
    /* Выборка ближайшего с усреднением по площади — картинка бывает крупнее места вдесятеро. */
    const sy0 = Math.floor((y / h) * image.height);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / h) * image.height));
    for (let x = 0; x < w; x += 1) {
      const tx = left + x;
      if (tx < 0 || tx >= width) continue;
      const sx0 = Math.floor((x / w) * image.width);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / w) * image.width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1)
        for (let sx = sx0; sx < sx1; sx += 1) {
          const at = (sy * image.width + sx) * 4;
          const alpha = image.rgba[at + 3];
          r += image.rgba[at] * alpha;
          g += image.rgba[at + 1] * alpha;
          b += image.rgba[at + 2] * alpha;
          a += alpha;
          n += 1;
        }
      if (!a) continue;
      const share = a / n / 255;
      const to = (ty * width + tx) * 4;
      dst[to] = Math.round(dst[to] * (1 - share) + (r / a) * share);
      dst[to + 1] = Math.round(dst[to + 1] * (1 - share) + (g / a) * share);
      dst[to + 2] = Math.round(dst[to + 2] * (1 - share) + (b / a) * share);
    }
  }
}

/**
 * Лист дирижабля в облике работы: RGBA `width × height` (по умолчанию
 * 512 × 256, как у игры). Фон — цвет оболочки, полосы и пояс — цвет полос
 * с тенью, сверху — надпись или картинка (`sign` — уже нарисованные
 * пиксели `{ rgba, width, height }`: надпись рисует окно общей системой
 * надписей) и строка под ней (`tagline` — тоже пиксели). Режим «как в
 * игре» листа не рисует — его берут из игры игрока.
 */
export function paintAirshipSign(input, { sign = null, tagline = null, width = AIRSHIP_SIGN_SIZE.width, height = AIRSHIP_SIGN_SIZE.height } = {}) {
  const blimp = normalizeAirshipsProject(input).blimp;
  const out = new Uint8ClampedArray(width * height * 4);
  const body = hexBytes(blimp.body);
  const stripe = hexBytes(blimp.stripe);
  const shadow = body.map((value) => Math.round(value * 0.32));
  const rows = (range) => [Math.round(range[0] * height), Math.round(range[1] * height)];
  const fill = ([y0, y1], colour) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 1)
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        out[at] = colour[0];
        out[at + 1] = colour[1];
        out[at + 2] = colour[2];
        out[at + 3] = 255;
      }
  };
  fill([0, height], body);
  fill(rows(AIRSHIP_SIGN_LAYOUT.stripe), stripe);
  fill(rows(AIRSHIP_SIGN_LAYOUT.stripeShadow), shadow);
  fill(rows(AIRSHIP_SIGN_LAYOUT.bandShadow), shadow);
  fill(rows(AIRSHIP_SIGN_LAYOUT.band), stripe);
  if (blimp.sign === "text" || blimp.sign === "image") {
    blendInto(out, width, height, sign, AIRSHIP_SIGN_LAYOUT.sign);
    if (blimp.tagline.trim()) blendInto(out, width, height, tagline, AIRSHIP_SIGN_LAYOUT.tagline);
  }
  /* Верх оболочки — ровным цветом оболочки (пятно вне надписи, но закрашивается всегда). */
  const [u0, v0, u1, v1] = AIRSHIP_SIGN_LAYOUT.top;
  for (let y = Math.round(v0 * height); y < Math.round(v1 * height); y += 1)
    for (let x = Math.round(u0 * width); x < Math.round(u1 * width); x += 1) {
      const at = (y * width + x) * 4;
      out[at] = body[0];
      out[at + 1] = body[1];
      out[at + 2] = body[2];
    }
  return out;
}

/** Нужна ли листу надпись, нарисованная окном. */
export const airshipSignNeedsText = (input) => {
  const blimp = normalizeAirshipsProject(input).blimp;
  return blimp.sign === "text" && emblemTextFilled(blimp.text);
};

/** Строка под надписью — той же надписью меньше: цвет полос, без обводки. */
export function airshipTaglineText(input) {
  const blimp = normalizeAirshipsProject(input).blimp;
  if (!blimp.tagline.trim()) return null;
  return normalizeEmblemText({ ...blimp.text, value: blimp.tagline, colour: blimp.stripe, outline: "dark" });
}

/* ------------------------------------------------------------------ *
 * Полёт
 * ------------------------------------------------------------------ */

/* Кадров на круг: шаг в градус — хорда круга в 420 м отходит от дуги на 1,6 см. */
const ORBIT_FRAMES = 361;
/*
 * Круг — не дольше пяти минут. У всех 1 245 клипов построек игры 30 кадров
 * в секунду (разбор всех .ycd Legacy, 11.10.2026); хост пересчитывает путь в
 * эту частоту и до 300 с держит её, а дольше — режет до 15/10/5, какие у
 * игры бывают только у персонажей. Поэтому медленный полёт — меньший круг,
 * а не круг дольше пяти минут.
 */
export const AIRSHIP_MAX_LAP = 300;

/* Произведение кватернионов (x, y, z, w): сначала поворачивает `b`, потом `a`. */
export function quatMultiply([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

const axisAngle = ([x, y, z], angle) => {
  const half = Math.sin(angle / 2);
  return [x * half, y * half, z * half, Math.cos(angle / 2)];
};

/*
 * Поворот модели: сначала крен вокруг её продольной оси (Y), потом тангаж
 * вокруг поперечной (X), потом курс вокруг вертикали (Z). Крен больше
 * нуля опускает правый борт, тангаж больше нуля поднимает нос, курс
 * больше нуля ведёт нос от +Y к −X.
 */
export function yawPitchRoll(yaw, pitch, roll) {
  return quatMultiply(quatMultiply(axisAngle([0, 0, 1], yaw), axisAngle([1, 0, 0], pitch)), axisAngle([0, 1, 0], roll));
}

/** Точка `v` модели, повёрнутая кватернионом `q`. */
export function quatRotate([qx, qy, qz, qw], [x, y, z]) {
  const [rx, ry, rz] = quatMultiply(quatMultiply([qx, qy, qz, qw], [x, y, z, 0]), [-qx, -qy, -qz, qw]);
  return [rx, ry, rz];
}

/**
 * Полёт вида: `{ duration, frames: [[x, y, z, qx, qy, qz, qw] …], radius,
 * bob, reach }` — место и поворот модели по кадрам в осях сущности (центр
 * круга — начало). Круг — против часовой, если смотреть сверху; нос (+Y
 * модели) смотрит по ходу, в повороте — крен внутрь, подъём и спуск —
 * целым числом волн на круг (клип по кругу без стыка). У НЛО — ещё своё
 * вращение, у шаров и фонариков — курс почти не меняется (их несёт ветер).
 * Последний кадр — то же место и тот же поворот, что первый; кватернион
 * при этом непрерывный по знаку (у курса 2π он противоположный).
 */
export function airshipFlight(kindId, input) {
  const info = airshipKind(kindId);
  if (!info) throw new Error(`Нет вида летающего ${kindId}.`);
  const project = normalizeAirshipsProject(input);
  const speed = info.speed * project.speed;
  const radius = Math.floor(Math.min(info.radius, (speed * AIRSHIP_MAX_LAP) / (2 * Math.PI)) * 100) / 100;
  const duration = Math.round(((2 * Math.PI * radius) / speed) * 100) / 100;
  const bank = (info.bank * Math.PI) / 180;
  const frames = [];
  for (let index = 0; index < ORBIT_FRAMES; index += 1) {
    const share = index / (ORBIT_FRAMES - 1);
    const angle = share * Math.PI * 2;
    const wave = share * Math.PI * 2 * info.waves;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    const z = info.bob * Math.sin(wave);
    /* Тангаж — по вертикальной скорости: нос вверх на подъёме. */
    const climb = (info.bob * info.waves * Math.cos(wave)) / radius;
    let yaw;
    let pitch = 0;
    let roll = 0;
    if (info.heading) {
      /* Нос (+Y) по касательной: поворот на угол круга. */
      yaw = angle + info.spin * angle;
      pitch = info.spin ? 0.05 * Math.sin(wave) : Math.atan(climb);
      /* Крен внутрь поворота — левым бортом вниз (круг против часовой). */
      roll = info.spin ? 0.05 * Math.cos(wave) : -bank;
    } else {
      /* Шар и фонарик: курс медленно плывёт (четверть оборота туда и обратно), лёгкое покачивание. */
      yaw = 0.5 * Math.sin(angle);
      pitch = 0.03 * Math.sin(wave);
      roll = 0.03 * Math.cos(wave);
    }
    const q = yawPitchRoll(yaw, pitch, roll);
    frames.push([x, y, z, ...q].map((value) => Math.round(value * 1e5) / 1e5));
  }
  /* Последний кадр — первое место (круг замкнут) и тот же поворот непрерывным знаком. */
  frames[frames.length - 1][0] = frames[0][0];
  frames[frames.length - 1][1] = frames[0][1];
  frames[frames.length - 1][2] = frames[0][2];
  return { duration, frames, radius, bob: info.bob, reach: radius };
}

/* ------------------------------------------------------------------ *
 * Расстановка
 * ------------------------------------------------------------------ */

const skyBytes = (() => {
  const text = AIRSHIP_SKY.data;
  if (typeof atob === "function") return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  return new Uint8Array(globalThis.Buffer.from(text, "base64"));
})();

/** Наибольшая высота крыш, крон и гор, м, в круге `radius` вокруг (x, y). */
export function airshipSkyFloor(x, y, radius = 0) {
  const { width, height, x0, y0, cell, scale } = AIRSHIP_SKY;
  const c0 = Math.max(0, Math.floor((x - radius - x0) / cell));
  const c1 = Math.min(width - 1, Math.floor((x + radius - x0) / cell));
  const r0 = Math.max(0, Math.floor((y - radius - y0) / cell));
  const r1 = Math.min(height - 1, Math.floor((y + radius - y0) / cell));
  let peak = 0;
  for (let row = r0; row <= r1; row += 1)
    for (let column = c0; column <= c1; column += 1) {
      /* Клетка задевает круг — ближайшая её точка не дальше радиуса. */
      const cx = Math.max(x0 + column * cell, Math.min(x, x0 + (column + 1) * cell));
      const cy = Math.max(y0 + row * cell, Math.min(y, y0 + (row + 1) * cell));
      if (Math.hypot(cx - x, cy - y) > radius + 1e-6) continue;
      peak = Math.max(peak, skyBytes[row * width + column] * scale);
    }
  return peak;
}

/* Детерминированный ряд случайных чисел (mulberry32): одна работа — одно небо. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(text) {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
  return hash;
}

/* Запас над крышами под кругом и разброс высоты копий, м. */
const CLEARANCE = 25;
const SPREAD = 60;
/* Фонарики летят стайками: до восьми у одного центра, в 140 м от него и в 30 м по высоте. */
const FLOCK = Object.freeze({ lantern: Object.freeze({ size: 8, reach: 140, spread: 30 }) });

/**
 * Где летает каждая копия: `[{ kind, index, position: [x, y, z], heading,
 * rotation: [x, y, z, w] }]` — центр круга, высота и поворот круга (с него
 * копия начинает путь). Центры — в прямоугольнике места, подальше друг от
 * друга (из нескольких проб — самый далёкий от уже поставленных); высота —
 * над наибольшей высотой карты под всем кругом, плюс «Высота» работы,
 * плюс своя у вида и у копии. Порядок и числа — одни и те же у одной
 * работы: окно и установщик видят одно небо.
 */
export function airshipPlacements(input) {
  const project = normalizeAirshipsProject(input);
  const [ax0, ay0, ax1, ay1] = airshipArea(project.area).box;
  const placed = [];
  /* Свободный центр: из нескольких проб — самый далёкий от уже поставленных. */
  const freeCentre = (next, radius) => {
    let best = null;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const x = ax0 + next() * (ax1 - ax0);
      const y = ay0 + next() * (ay1 - ay0);
      let room = Infinity;
      for (const other of placed) {
        const span = Math.hypot(other.position[0] - x, other.position[1] - y) - 0.5 * (other.radius + radius);
        room = Math.min(room, span);
      }
      if (!best || room > best.room) best = { x, y, room };
    }
    return best;
  };
  for (const info of AIRSHIP_KINDS) {
    const count = project.fleet[info.id].count;
    const next = random(seedOf(`${project.area}|${info.id}`));
    const flock = FLOCK[info.id] || null;
    let leader = null;
    for (let index = 0; index < count; index += 1) {
      let best;
      let spread = SPREAD;
      if (flock) {
        /* Новая стайка — свободный центр с запасом на её размах; копии — вокруг него. */
        if (index % flock.size === 0) {
          const centre = freeCentre(next, info.radius + flock.reach);
          const floor = airshipSkyFloor(centre.x, centre.y, info.radius + flock.reach + 60);
          leader = { ...centre, floor, lift: next() * SPREAD };
        }
        const turn = next() * Math.PI * 2;
        const away = Math.sqrt(next()) * flock.reach;
        best = { x: leader.x + Math.cos(turn) * away, y: leader.y + Math.sin(turn) * away };
        spread = flock.spread;
      } else best = freeCentre(next, info.radius);
      const heading = next() * Math.PI * 2;
      const floor = flock ? leader.floor : airshipSkyFloor(best.x, best.y, info.radius + 60);
      const z = floor + CLEARANCE + info.lift + project.altitude + (flock ? leader.lift : 0) + next() * spread + info.bob;
      placed.push({
        kind: info.id,
        index,
        radius: info.radius,
        position: [best.x, best.y, z].map((value) => Math.round(value * 100) / 100),
        heading: Math.round(heading * 1e5) / 1e5,
        rotation: [0, 0, Math.sin(heading / 2), Math.cos(heading / 2)].map((value) => Math.round(value * 1e6) / 1e6),
      });
    }
  }
  return placed;
}
