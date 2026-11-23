/*
 * Счётчик урона (владелец, 30.10.2026): одно описание на редактор, кадр и
 * компилятор `hud_reticle.gfx`.
 *
 * ОТКУДА ЧИСЛО. Игра сообщает прицелу только факт попадания:
 * `SHOW_HITMARKER(1)` — убийство, `SHOW_HITMARKER(2)` — попадание, у снайперок
 * ещё `SHOW_SNIPER_HIT()`. Размера урона в фильме нет, а чтение памяти игры —
 * это античит и бан. Поэтому на каждое попадание счётчик прибавляет число ствола
 * в руках из выбранной таблицы (`server`):
 *
 *  • `gta5rp`, `majestic` — база по телу из вики проекта (`server-damage.js`):
 *    там урон считает сервер, а числа `weapons.meta` неверны. Голову, руки и
 *    ноги, дальность, резист и бронебойность игра прицелу не сообщает: окно
 *    говорит об этом прямо. Ствол вне таблицы счётчик не считает вовсе: прибавка
 *    0 значит «попадание не считается», чужое число он не подставляет.
 *  • `files` — числа из файлов оружия игры игрока: `Damage ×
 *    NetworkPlayerDamageModifier` блока `CWeaponInfo`. Снято с weapons.meta Legacy
 *    30.10.2026: `NetworkPedDamageModifier` у всех 1, `NetworkPlayerDamageModifier`
 *    у всех 1, кроме хевика и марксманок (1,39); хевик по игроку — 216 × 1,39 =
 *    300. `Damage = 0` бывает там, где урон не пулей (рукопашная, взрывы), — тогда
 *    `HudDamage`, число со шкалы урона в колесе оружия.
 *
 * Ручных чисел нет (владелец, 30.10.2026): поля `multiplier` и `weaponDamage`,
 * выпущенные в beta.77, из сохранённых работ молча отбрасываются.
 *
 * ГДЕ. Точка счётчика — в точках сцены `hud_reticle.gfx` 1280×720, строка стоит
 * серединой в точке. Счётчик не привязан к прицелу: клип лежит на корне фильма,
 * поверх `CONTENT`, и не зависит от того, что игра прячет прицел.
 *
 * ВРЕМЯ — кадрами фильма (30 в секунду), как знак на килле: и файл, и кадр
 * редактора идут по одному автомату (`damageCounterHit`, `damageCounterTick`).
 */

import { AMMO_FIELD_GUTTER, AMMO_FONTS, ammoFont } from "./ammo.js";
import {
  DAMAGE_SERVER_IDS,
  DEFAULT_DAMAGE_SERVER,
  FILES_DAMAGE_SERVER,
  damageServerOfProject,
  serverWeaponDamage,
} from "./server-damage.js";
import { RETICLE_STAGE } from "./stage.js";

/** Кадров в секунду у фильма прицела. */
export const DAMAGE_COUNTER_FPS = 30;

/** Кегль поля в файле, точек: размер счётчика — масштаб клипа. */
export const DAMAGE_FIELD_SIZE = 48;
export const DAMAGE_FIELD_WIDTH = 960;

/** Шрифты — те же шрифты игры, что у счётчика патронов. */
export const DAMAGE_COUNTER_FONTS = AMMO_FONTS;

/** Затухание в конце срока, толчок на попадание, перелив. */
export const DAMAGE_FADE_FRAMES = 12;
export const DAMAGE_BUMP_FRAMES = 6;
export const DAMAGE_BUMP_SCALE = 0.18;
export const DAMAGE_RAINBOW_STEPS = 36;

export const DAMAGE_COLOR_MODES = Object.freeze([
  Object.freeze({ id: "solid", label: "Один цвет", note: "один цвет на всё время" }),
  Object.freeze({ id: "rainbow", label: "Радуга", note: "цвет переливается по кругу" }),
]);

/** Пределы ползунков: у каждого — поле числом с теми же пределами. Размер — от 4 при обычных 30 (≈ 13 %, владелец 16.11.2026: «меньше, вообще маленьким»). */
export const DAMAGE_COUNTER_LIMITS = Object.freeze({
  x: Object.freeze({ min: 0, max: RETICLE_STAGE.width, step: 1, unit: "", label: "По горизонтали" }),
  y: Object.freeze({ min: 0, max: RETICLE_STAGE.height, step: 1, unit: "", label: "По вертикали" }),
  size: Object.freeze({ min: 4, max: 96, step: 1, unit: "", label: "Размер" }),
  outline: Object.freeze({ min: 0, max: 4, step: 0.5, unit: "", label: "Обводка" }),
  opacity: Object.freeze({ min: 10, max: 100, step: 5, unit: "%", label: "Прозрачность" }),
  rainbowSpeed: Object.freeze({ min: 10, max: 300, step: 10, unit: "%", label: "Скорость перелива" }),
  resetSeconds: Object.freeze({ min: 1, max: 15, step: 0.5, unit: "с", label: "Сброс без попаданий" }),
});

/* Новый счётчик — справа от прицела, белый, с обводкой. Выключен: старые
   работы и готовые прицелы не меняются, файл без него байт в байт прежний. */
export const DAMAGE_COUNTER_DEFAULTS = Object.freeze({
  enabled: false,
  colorMode: "solid",
  color: "#ffffff",
  rainbowSpeed: 100,
  opacity: 100,
  font: "cash",
  size: 30,
  outline: 1.5,
  x: 712,
  y: 340,
  minus: true,
  bump: true,
  resetSeconds: 3,
  resetOnKill: true,
  server: DEFAULT_DAMAGE_SERVER,
});

const FONT_IDS = new Set(AMMO_FONTS.map((item) => item.id));
const MODE_IDS = new Set(DAMAGE_COLOR_MODES.map((item) => item.id));
const HEX = /^#[0-9a-f]{6}$/i;

const bounded = (value, { min, max, step }, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const stepped = Math.round(number / step) * step;
  return Math.min(max, Math.max(min, Math.round(stepped * 100) / 100));
};

/** Счётчик в границах договора; чужие поля отбрасываются. */
export function normalizeDamageCounter(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const base = DAMAGE_COUNTER_DEFAULTS;
  const limits = DAMAGE_COUNTER_LIMITS;
  return {
    enabled: source.enabled === true,
    colorMode: MODE_IDS.has(source.colorMode) ? source.colorMode : base.colorMode,
    color: HEX.test(String(source.color || "")) ? String(source.color).toLowerCase() : base.color,
    rainbowSpeed: bounded(source.rainbowSpeed, limits.rainbowSpeed, base.rainbowSpeed),
    opacity: bounded(source.opacity, limits.opacity, base.opacity),
    font: FONT_IDS.has(source.font) ? source.font : base.font,
    size: bounded(source.size, limits.size, base.size),
    outline: bounded(source.outline, limits.outline, base.outline),
    x: bounded(source.x, limits.x, base.x),
    y: bounded(source.y, limits.y, base.y),
    minus: source.minus !== false,
    bump: source.bump !== false,
    resetSeconds: bounded(source.resetSeconds, limits.resetSeconds, base.resetSeconds),
    resetOnKill: source.resetOnKill !== false,
    server: DAMAGE_SERVER_IDS.has(source.server) ? source.server : base.server,
  };
}

/**
 * Правка счётчика из редактора: любая его настройка включает его, выключает
 * только сам выключатель (`change.enabled`). Так же, как у счётчика патронов:
 * настроенный, но выключенный счётчик в игру не уходил бы молча.
 */
export function editDamageCounter(current, change = {}) {
  const next = { ...normalizeDamageCounter(current), ...change };
  next.enabled = typeof change.enabled === "boolean" ? change.enabled : true;
  return normalizeDamageCounter(next);
}

/**
 * Работа, где сервер ещё не выбран, идёт за проектом приложения: и в окне, и при
 * «Применить». Первая же правка счётчика записывает сервер в работу.
 */
export function damageCounterForProject(input, project) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return DAMAGE_SERVER_IDS.has(source.server)
    ? source
    : { ...source, server: damageServerOfProject(project) };
}

/** Шрифт счётчика: запись из `AMMO_FONTS`. */
export const damageFont = (id) => ammoFont(id);

/* ------------------------------ раскладка ------------------------------ */

/** Масштаб клипа в процентах: поле в файле одного кегля. */
export const damageCounterScale = (size) => (size / DAMAGE_FIELD_SIZE) * 100;

/**
 * Верх поля относительно точки при кегле файла, чтобы середина цифр пришлась
 * на точку: та же арифметика, что `ammoFieldTop`.
 */
export function damageFieldTop(fontId) {
  const { metrics } = ammoFont(fontId);
  const scale = DAMAGE_FIELD_SIZE / metrics.nominal;
  return -(AMMO_FIELD_GUTTER + metrics.ascent * scale - (metrics.cap * scale) / 2);
}

/*
 * Обводка — восемь копий строки чёрным со сдвигом: своё поле у каждой. Фильтры
 * поля в Scaleform зависят от сборки, а перекрытие разных полей ничего не
 * вырезает (дыры дают только заливки внутри одной фигуры).
 */
const OUTLINE_DIRECTIONS = Object.freeze([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
]);

/** Сдвиги копий обводки в точках поля (до масштаба клипа). */
export function damageOutlineOffsets(input) {
  const counter = normalizeDamageCounter(input);
  if (counter.outline <= 0) return [];
  const reach = counter.outline * (DAMAGE_FIELD_SIZE / counter.size);
  return OUTLINE_DIRECTIONS.map(([x, y]) => [x * reach, y * reach]);
}

/** Строка счётчика: сумма целым числом, по желанию с минусом. */
export function damageCounterText(total, input) {
  const counter = normalizeDamageCounter(input);
  return `${counter.minus ? "-" : ""}${Math.round(total)}`;
}

/* ----------------------------- перелив ----------------------------- */

function hueToRgb(hue) {
  const sector = (hue % 360) / 60;
  const side = Math.round(255 * (1 - Math.abs((sector % 2) - 1)));
  if (sector < 1) return [255, side, 0];
  if (sector < 2) return [side, 255, 0];
  if (sector < 3) return [0, 255, side];
  if (sector < 4) return [0, side, 255];
  if (sector < 5) return [side, 0, 255];
  return [255, 0, side];
}

/** Цвета перелива по кругу: числа `0xRRGGBB`, файл кладёт их списком. */
export const DAMAGE_RAINBOW = Object.freeze(
  Array.from({ length: DAMAGE_RAINBOW_STEPS }, (_, index) => {
    const [red, green, blue] = hueToRgb((index * 360) / DAMAGE_RAINBOW_STEPS);
    return red * 65536 + green * 256 + blue;
  }),
);

/** Шаг перелива за кадр: при 100 % полный круг за две секунды. */
export const damageRainbowStep = (speed) =>
  (DAMAGE_RAINBOW_STEPS / (2 * DAMAGE_COUNTER_FPS)) * (speed / 100);

/* ------------------------------ автомат ------------------------------ */

/** Сколько кадров число держится полностью, прежде чем начать гаснуть. */
export const damageHoldFrames = (resetSeconds) =>
  Math.max(1, Math.round(resetSeconds * DAMAGE_COUNTER_FPS) - DAMAGE_FADE_FRAMES);

/** Счётчик до первого попадания. */
export const DAMAGE_COUNTER_IDLE = Object.freeze({
  total: 0,
  frames: 0,
  bump: 0,
  hue: 0,
  killed: false,
  visible: false,
});

/**
 * Попадание: прибавить урон ствола. После убийства с «Сбросить после убийства»
 * число дотлевает как обычно, а следующее попадание начинает новую сумму. Ствол
 * без числа (`damage` 0) не считается: сумма и срок остаются как были.
 */
export function damageCounterHit(state, input, { damage = 0, kill = false } = {}) {
  if (!(damage > 0)) return state || DAMAGE_COUNTER_IDLE;
  const counter = normalizeDamageCounter(input);
  const base = state?.killed ? 0 : state?.total || 0;
  return {
    total: base + damage,
    frames: 0,
    bump: counter.bump ? DAMAGE_BUMP_FRAMES : 0,
    hue: state?.hue || 0,
    killed: Boolean(kill && counter.resetOnKill),
    visible: true,
  };
}

/** Один кадр фильма: перелив, толчок, затухание и обнуление в конце срока. */
export function damageCounterTick(state, input) {
  if (!state?.visible) return state || DAMAGE_COUNTER_IDLE;
  const counter = normalizeDamageCounter(input);
  const frames = state.frames + 1;
  const hue = counter.colorMode === "rainbow"
    ? (state.hue + damageRainbowStep(counter.rainbowSpeed)) % DAMAGE_RAINBOW_STEPS
    : state.hue;
  if (frames >= damageHoldFrames(counter.resetSeconds) + DAMAGE_FADE_FRAMES)
    return { ...DAMAGE_COUNTER_IDLE, hue };
  return { ...state, frames, hue, bump: Math.max(0, state.bump - 1) };
}

/** Что сейчас рисовать: прозрачность 0…100, масштаб-доля толчка и цвет. */
export function damageCounterLook(state, input) {
  const counter = normalizeDamageCounter(input);
  const hold = damageHoldFrames(counter.resetSeconds);
  const frames = state?.frames || 0;
  const fade = frames > hold ? 1 - (frames - hold) / DAMAGE_FADE_FRAMES : 1;
  const colour = counter.colorMode === "rainbow"
    ? DAMAGE_RAINBOW[Math.floor(state?.hue || 0)]
    : Number.parseInt(counter.color.slice(1), 16);
  return {
    alpha: counter.opacity * fade,
    bump: 1 + (DAMAGE_BUMP_SCALE * (state?.bump || 0)) / DAMAGE_BUMP_FRAMES,
    colour: `#${colour.toString(16).padStart(6, "0")}`,
  };
}

/* ------------------------------ урон стволов ------------------------------ */

/*
 * Урон из файлов игры: `{ damage, playerModifier, hud }`. Нужен режиму «Как в
 * файлах игры» — кадру редактора и запасной сборке без игры; при установке те же
 * числа читаются из файлов игрока (`readWeaponDamage` в `reticle-weapons.js`).
 * Снято с Legacy 30.10.2026.
 */
const stock = (damage, playerModifier = 1, hud = damage) => Object.freeze({ damage, playerModifier, hud });
export const STOCK_WEAPON_DAMAGE = Object.freeze({
  WEAPON_UNARMED: stock(0, 1, 5),
  WEAPON_GRENADE: stock(0, 1, 95),
  WEAPON_RPG: stock(0, 1, 100),
  WEAPON_GRENADELAUNCHER: stock(0, 1, 95),
  WEAPON_PISTOL: stock(26),
  WEAPON_PISTOL_MK2: stock(32),
  WEAPON_COMBATPISTOL: stock(27),
  WEAPON_APPISTOL: stock(25),
  WEAPON_PISTOL50: stock(51),
  WEAPON_SNSPISTOL: stock(28),
  WEAPON_SNSPISTOL_MK2: stock(30),
  WEAPON_HEAVYPISTOL: stock(40),
  WEAPON_VINTAGEPISTOL: stock(34),
  WEAPON_MARKSMANPISTOL: stock(220),
  WEAPON_REVOLVER: stock(160),
  WEAPON_REVOLVER_MK2: stock(200),
  WEAPON_DOUBLEACTION: stock(81),
  WEAPON_NAVYREVOLVER: stock(160),
  WEAPON_CERAMICPISTOL: stock(32),
  WEAPON_GADGETPISTOL: stock(195),
  WEAPON_PISTOLXM3: stock(35),
  WEAPON_MICROSMG: stock(21),
  WEAPON_SMG: stock(22),
  WEAPON_SMG_MK2: stock(25),
  WEAPON_ASSAULTSMG: stock(23),
  WEAPON_COMBATPDW: stock(28),
  WEAPON_MACHINEPISTOL: stock(27),
  WEAPON_MINISMG: stock(22),
  WEAPON_TECPISTOL: stock(25),
  WEAPON_ASSAULTRIFLE: stock(30),
  WEAPON_ASSAULTRIFLE_MK2: stock(40),
  WEAPON_CARBINERIFLE: stock(32),
  WEAPON_CARBINERIFLE_MK2: stock(33),
  WEAPON_ADVANCEDRIFLE: stock(34),
  WEAPON_SPECIALCARBINE: stock(32),
  WEAPON_SPECIALCARBINE_MK2: stock(32.5),
  WEAPON_BULLPUPRIFLE: stock(32),
  WEAPON_BULLPUPRIFLE_MK2: stock(33),
  WEAPON_COMPACTRIFLE: stock(34),
  WEAPON_MILITARYRIFLE: stock(37.5),
  WEAPON_HEAVYRIFLE: stock(34),
  WEAPON_TACTICALRIFLE: stock(34.75),
  WEAPON_BATTLERIFLE: stock(38),
  WEAPON_MUSKET: stock(165),
  WEAPON_PUMPSHOTGUN: stock(29),
  WEAPON_PUMPSHOTGUN_MK2: stock(32),
  WEAPON_SAWNOFFSHOTGUN: stock(40),
  WEAPON_ASSAULTSHOTGUN: stock(32),
  WEAPON_BULLPUPSHOTGUN: stock(14),
  WEAPON_HEAVYSHOTGUN: stock(117),
  WEAPON_DBSHOTGUN: stock(30),
  WEAPON_AUTOSHOTGUN: stock(27),
  WEAPON_COMBATSHOTGUN: stock(31),
  WEAPON_MG: stock(40),
  WEAPON_COMBATMG: stock(45),
  WEAPON_COMBATMG_MK2: stock(47),
  WEAPON_GUSENBERG: stock(34),
  WEAPON_MINIGUN: stock(30),
  WEAPON_SNIPERRIFLE: stock(101),
  WEAPON_HEAVYSNIPER: stock(216, 1.39),
  WEAPON_HEAVYSNIPER_MK2: stock(230, 1.39),
  WEAPON_MARKSMANRIFLE: stock(65, 1.39),
  WEAPON_MARKSMANRIFLE_MK2: stock(75, 1.39),
  WEAPON_PRECISIONRIFLE: stock(101),
});

/**
 * Запасное значение для хеша без своего имени: штатный стиль → ствол, чей урон
 * он берёт. Сюда попадают стволы, файл которых заменил чужой ганпак, стволы
 * сверх потолка и всё, у чего стиль не обычный прицел. Оптику игра берёт у
 * насадки, одной на несколько стволов, поэтому у снайперок значение — по оптике.
 * Имена — члены класса `HUD_RETICLE`: сравнение идёт с его же константами.
 */
export const DAMAGE_STYLE_SOURCE = Object.freeze({
  WEAPON_PISTOL: "WEAPON_PISTOL",
  WEAPONTYPE_SMG: "WEAPON_SMG",
  WEAPONTYPE_RIFLE: "WEAPON_ASSAULTRIFLE",
  WEAPONTYPE_SHOTGUN: "WEAPON_PUMPSHOTGUN",
  WEAPON_THROWN: "WEAPON_GRENADE",
  WEAPON_UNARMED: "WEAPON_UNARMED",
  WEAPON_HEAVY_RPG: "WEAPON_RPG",
  WEAPON_HEAVY_GRENADE_LAUNCHER: "WEAPON_GRENADELAUNCHER",
  SIMPLE_RETICLE: "WEAPON_PISTOL",
  SIMPLE_MP_RETICLE: "WEAPON_PISTOL",
  SNIPER_LARGE: "WEAPON_SNIPERRIFLE",
  SNIPER_MAX: "WEAPON_HEAVYSNIPER",
});

/** Ствол со своим значением оптики в списке редактора. */
export const DAMAGE_SCOPE_WEAPONS = Object.freeze(["WEAPON_SNIPERRIFLE", "WEAPON_HEAVYSNIPER"]);

const round2 = (value) => Math.round(value * 100) / 100;

/** Урон ствола по его числам из файла: `Damage × множитель по игрокам`. */
export function weaponInfoDamage(info) {
  if (!info) return 0;
  const damage = Number(info.damage) || 0;
  if (damage > 0) return round2(damage * (Number(info.playerModifier) || 1));
  return round2(Number(info.hud) || 0);
}

/**
 * Что прибавлять за попадание этим стволом: число выбранной таблицы или, в режиме
 * «Как в файлах игры», урон из файла. 0 — ствола нет в таблице, попадание не
 * считается.
 */
export function damageForWeapon(input, weapon, info) {
  const { server } = normalizeDamageCounter(input);
  if (server === FILES_DAMAGE_SERVER) return weaponInfoDamage(info);
  return serverWeaponDamage(server, weapon) ?? 0;
}

/*
 * Простой прицел может прийти от любого ствола, поэтому у таблицы сервера числа
 * для него нет: неизвестно, чей это выстрел.
 */
const NO_SERVER_VALUE = new Set(["SIMPLE_RETICLE", "SIMPLE_MP_RETICLE"]);

/**
 * Значения по штатным стилям и запасное для незнакомого хеша (класс ведёт его
 * как пистолет). `infoOf(ствол)` — его числа из файлов игры или `null`, тогда
 * берётся таблица Legacy.
 *
 * Как в файлах: ноль не показывают, взамен значение пистолета. У таблицы сервера
 * стиль стоит за целый класс стволов, поэтому значение — основной ствол класса
 * (`DAMAGE_STYLE_SOURCE`), о чём сказано в окне, а незнакомый хеш считается нулём:
 * чей это выстрел, неизвестно.
 */
export function damageStyleTable(input, infoOf = () => null) {
  const counter = normalizeDamageCounter(input);
  const valueOf = (weapon) =>
    damageForWeapon(counter, weapon, infoOf(weapon) || STOCK_WEAPON_DAMAGE[weapon]);
  if (counter.server !== FILES_DAMAGE_SERVER)
    return {
      styles: Object.entries(DAMAGE_STYLE_SOURCE).map(([style, weapon]) => ({
        style,
        value: NO_SERVER_VALUE.has(style) ? 0 : valueOf(weapon),
      })),
      fallback: 0,
    };
  const fallback = valueOf("WEAPON_PISTOL");
  const styles = Object.entries(DAMAGE_STYLE_SOURCE).map(([style, weapon]) => ({
    style,
    value: valueOf(weapon) || fallback,
  }));
  return { styles, fallback };
}
