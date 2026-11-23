/*
 * «Интерьеры»: проверенные замены вещей и готовые интерьеры помещений
 * (задача 4 ТЗ 11.10.2026, ночь: «не на тяп-ляп, а реальные шаблоны — как
 * со стульями в арене»).
 *
 * Прежде «Свои полки и вещи» ставили на место вещи любую модель каталога
 * помещения (до 40 на группу) — на тот же «нуль» модели, без доворота и по
 * рамке архетипа: стеллаж футболок вместо полки, телефонная будка вместо
 * диспенсера сока на прилавке, горшок над полом. Теперь вещь меняется только
 * на модель из проверенных пар: каждая пара (вещь → модель) снята в кадре
 * помещения и проверена глазами — тот же размер, низ на полу, лицом в зал,
 * задником к стене, без зазора и висения.
 *
 * Пара (`SHOP_SWAP_PAIRS`): `turn` — доворот новой модели вокруг вертикали
 * в осях вещи (0, 90, 180, 270°: «лицо» у моделей бывает в любую сторону),
 * `anchor` — чем новая модель встаёт на место вещи: серединой (`centre`) или
 * стороной вещи (`+x`, `-x`, `+y`, `-y` в осях вещи — задник к стене). Низ
 * новой модели — всегда на низ вещи. Место считает одна функция
 * (`shopSwapPlace`) — и кадр, и установщик (`recolor-shops.js`: модель,
 * место и поворот сущности MLO).
 *
 * Помещение (`SHOP_KITS`): варианты групп (`groups` — набор пар под одним
 * названием: «Газировка», «Барные холодильники») и готовые интерьеры
 * (`templates` — варианты групп вместе с цветом стен, пола и потолка).
 * Помещение без проверенных пар — только цвет и текстуры: `why` говорит
 * почему (одной фразой в панели «Предметы»).
 */

import SHOPS_INVENTORY from "./inventory/shops.js";
import { placementTransform } from "./placement.js";

/* ------------------------------------------------------------------ *
 * Место новой модели
 * ------------------------------------------------------------------ */

const mm = (value) => Math.round(value * 1000) / 1000;

/*
 * Стороны, которыми новая модель встаёт к вещи: `"centre"` — серединой,
 * `"+y"` — задником к стене за вещью (сторона +y в осях вещи), `"+y-x"` —
 * задником и левым боком (к соседу слева). `[x, y]`: 1, −1 или 0.
 */
function anchorSides(anchor) {
  const sides = [0, 0];
  for (const [, sign, axis] of String(anchor || "").matchAll(/([+-])([xy])/g)) sides[axis === "x" ? 0 : 1] = sign === "+" ? 1 : -1;
  return sides;
}

/** Рамка модели в её осях (`{ min, max }`, по сеткам, что рисует игра) или `null`. */
export function shopModelBox(model) {
  const record = SHOPS_INVENTORY.models?.[model];
  return Array.isArray(record?.min) && Array.isArray(record?.max) ? { min: record.min, max: record.max } : null;
}

/* Рамка, довёрнутая вокруг вертикали: 90° — (x, y) → (−y, x). */
function turnedBox({ min, max }, turn) {
  if (turn === 90) return { min: [-max[1], min[0], min[2]], max: [-min[1], max[0], max[2]] };
  if (turn === 180) return { min: [-max[0], -max[1], min[2]], max: [-min[0], -min[1], max[2]] };
  if (turn === 270) return { min: [min[1], -max[0], min[2]], max: [max[1], -min[0], max[2]] };
  return { min, max };
}

const quarter = (turn) => (((Math.round(Number(turn) / 90) * 90) % 360) + 360) % 360;

/**
 * Как новая модель встаёт на место вещи: `{ turn, offset }` — доворот (°) и
 * сдвиг начала модели в осях вещи (м), или `null`, когда рамки модели нет.
 * Низ — на низ вещи; по сторонам — серединой или стороной `anchor`.
 */
export function shopSwapFit(from, to, { turn = 0, anchor = "centre" } = {}) {
  const was = shopModelBox(from);
  const now = shopModelBox(to);
  if (!was || !now) return null;
  const angle = quarter(turn);
  const box = turnedBox(now, angle);
  const sides = anchorSides(anchor);
  const offset = [0, 1].map((axis) => {
    if (sides[axis] > 0) return was.max[axis] - box.max[axis];
    if (sides[axis] < 0) return was.min[axis] - box.min[axis];
    return (was.min[axis] + was.max[axis]) / 2 - (box.min[axis] + box.max[axis]) / 2;
  });
  offset.push(was.min[2] - box.min[2]);
  return { turn: angle, offset: offset.map(mm) };
}

/* Произведение кватернионов a·b (x, y, z, w). */
function multiply([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

/**
 * Место сущности с новой моделью: `place` — `[x, y, z, qx, qy, qz, qw, xy, z]`
 * как записано в типах помещения (кватернион — обратный, как у игры:
 * `placement.js`), `fit` — `shopSwapFit`. Начало модели сдвигается на
 * `offset` в осях вещи (с её поворотом и масштабом), поворот — доворачивается
 * на `turn` вокруг её вертикали. Одна арифметика у кадра и установщика.
 */
export function shopSwapPlace(place, fit) {
  if (!fit || !Array.isArray(place)) return place;
  const [px, py, pz, qx, qy, qz, qw, sxy = 1, sz = 1] = place;
  const scale = [sxy || 1, sxy || 1, sz || 1];
  const turn = placementTransform({ position: [0, 0, 0], rotation: [qx, qy, qz, qw], scaleXY: 1, scaleZ: 1 });
  const [dx, dy, dz] = turn(fit.offset.map((value, axis) => value * scale[axis]));
  /* Мир = поворот(¬q)·доворот(t): записанный кватернион становится ¬t·q. */
  const angle = quarter(fit.turn);
  if (!angle) return [px + dx, py + dy, pz + dz, qx, qy, qz, qw, sxy, sz];
  const half = (angle * Math.PI) / 360;
  const rotation = multiply([0, 0, -Math.sin(half), Math.cos(half)], [qx, qy, qz, qw]);
  const length = Math.hypot(...rotation) || 1;
  return [px + dx, py + dy, pz + dz, ...rotation.map((value) => value / length), sxy, sz];
}

/* ------------------------------------------------------------------ *
 * Имена моделей для панели
 * ------------------------------------------------------------------ */

/* Модели проверенных пар — по-русски: что это за вещь, а не имя файла. */
export const SHOP_MODEL_LABELS = Object.freeze({
  prop_vend_coffe_01: "Кофейный автомат Bean Machine",
  prop_vend_water_01: "Автомат с водой Raine",
  prop_vend_fridge01: "Холодильник eCola",
  prop_vend_soda_01: "Автомат eCola",
  prop_vend_soda_02: "Автомат Sprunk",
  v_68_broeknvend: "Сломанный автомат Sprunk",
  prop_vend_snak_01: "Автомат снеков Candybox",
  prop_arcade_01: "Игровой автомат QUB3D",
  prop_50s_jukebox: "Музыкальный автомат 50-х",
  prop_jukebox_01: "Музыкальный автомат",
  prop_gumball_01: "Автомат жвачки на два шара",
  prop_gumball_02: "Маленький автомат жвачки",
  prop_gumball_03: "Синий автомат жвачки",
  prop_atm_01: "Банкомат",
  prop_atm_02: "Синий банкомат",
  prop_atm_03: "Красный банкомат",
  v_68_fridgefood: "Холодильники с едой",
  v_68_fridgedrinks: "Холодильники с напитками",
  prop_bar_beerfridge_01: "Холодильник с пивом",
  prop_bar_fridge_01: "Холодильник с вином",
  prop_bar_fridge_02: "Барный холодильник с глухими дверцами",
  prop_bar_fridge_04: "Барный холодильник со стеклом",
  prop_chair_01a: "Алюминиевый стул",
  prop_chair_01b: "Стул с мягким сиденьем",
  prop_chair_02: "Стул с подлокотниками",
  prop_chair_04a: "Пластиковый стул",
  prop_chair_05: "Плетёное кресло",
  prop_chair_06: "Металлический стул",
  prop_chair_07: "Деревянный стул",
  prop_chair_09: "Садовый стул",
  prop_chateau_chair_01: "Стул «Шато»",
  prop_off_chair_01: "Офисное кресло",
  prop_off_chair_03: "Серое офисное кресло",
  prop_off_chair_04: "Офисный стул",
  prop_off_chair_04b: "Синий офисный стул",
  prop_off_chair_05: "Кресло-сетка",
  v_club_officechair: "Кожаное кресло",
  v_corp_offchair: "Кресло администратора",
  v_corp_cd_chair: "Стул посетителя",
  v_corp_bk_chair3: "Стул менеджера",
  prop_direct_chair_01: "Режиссёрский стул",
  prop_gc_chair02: "Пластиковый стул",
  v_ret_gc_chair02: "Пластиковый стул",
  v_ret_fh_chair01: "Белый деревянный стул",
  v_res_mvasechinese: "Ваза с ветками",
  v_res_rubberplant: "Ваза с жёлтыми цветами",
  v_res_exoticvase: "Ваза со стрелицией",
  prop_plant_int_01a: "Пышное растение",
  prop_plant_int_01b: "Растение в горшке",
  prop_plant_int_02a: "Деревце-шар",
  prop_plant_int_02b: "Деревце-шар в корзине",
  v_corp_filecabtall: "Картотека",
  v_corp_filecabtall_01: "Картотека",
  v_corp_bk_filecab: "Картотека",
  prop_cabinet_02b: "Белая картотека",
  v_corp_lngestool: "Пуф",
  v_club_cc_stool: "Красный табурет",
});

/** Модель — словами панели: своё имя или имя файла без приставки («vend soda 01»). */
export const shopModelLabel = (model) =>
  SHOP_MODEL_LABELS[model] ||
  String(model || "")
    .replace(/^(prop|v_ret|v_res|v_serv|v_ind|v_corp|v_club|v_med|v_\d+|p)_/, "")
    .replace(/_/g, " ");

/* ------------------------------------------------------------------ *
 * Проверенные пары
 * ------------------------------------------------------------------ */

/*
 * Пара «вещь>модель» → как модель встаёт. Пара есть здесь, только если она
 * снята в кадре помещения и легла ровно (снимки — задание проверки
 * `docs/windows-checks/26-shops-templates.md`):
 *
 *   — автоматы, банкоматы, барные холодильники и картотеки стоят у стены:
 *     задником к ней, лицом в зал; соседей по ряду не задевают (кофейный
 *     автомат 24/7 меняется только на модели не шире его места: газировка в
 *     1 м ушла бы в полку и косяк двери). «Лицо» у всех этих моделей и у
 *     заменяемых вещей — сторона −y (больше вершин у грани: ящики, ручки,
 *     стекло), задник — `+y`;
 *   — холодильники LTD с едой и с напитками — одна стена разной начинки,
 *     модели собраны в осях помещения: доворот 270° и 90°;
 *   — стулья и кресла — серединой на место прежних: спинка у всех — со
 *     стороны +y (середина верхних вершин), поэтому доворот не нужен;
 *     растения — серединой, низ на полу.
 *
 * Не прошли (в кадре — криво): холодильники 24/7 и Rob's Liquor (нет модели
 * той же ширины: узкие встали бы с зазорами, «внутренность» холодильника —
 * без дверей), полки и стеллажи (товар на них — свои вещи, повис бы в
 * воздухе), витрины одежды и оружия, оборудование гаражей, кресла с
 * манекенами, барные охладители 1,5 м (наезжали на соседей), табурет за
 * стойкой тату-салонов (круглый: куда смотрело бы кресло на его месте, по
 * модели не узнать — в кадре оно отвернулось от стола).
 */
const WALL = Object.freeze({ turn: 0, anchor: "+y" });
const CENTRE = Object.freeze({ turn: 0, anchor: "centre" });
const pairs = (from, list, spec) => list.map((to) => [`${from}>${to}`, spec]);

export const SHOP_SWAP_PAIRS = Object.freeze(
  Object.fromEntries([
    /* Автоматы у стены. */
    ...pairs("prop_vend_coffe_01", ["prop_vend_water_01", "prop_vend_fridge01", "prop_arcade_01", "prop_50s_jukebox"], WALL),
    ...pairs("prop_vend_soda_01", ["prop_vend_soda_02", "prop_vend_snak_01", "prop_jukebox_01"], WALL),
    ...pairs("prop_vend_soda_02", ["prop_vend_soda_01", "prop_jukebox_01"], WALL),
    ...pairs("prop_vend_snak_01", ["prop_vend_soda_02"], WALL),
    ...pairs("v_68_broeknvend", ["prop_vend_soda_01", "prop_vend_soda_02"], WALL),
    ...pairs("prop_gumball_01", ["prop_gumball_02", "prop_gumball_03"], CENTRE),
    ...pairs("prop_gumball_03", ["prop_gumball_01"], CENTRE),
    /* Банкоматы: настенные модели — задником к стене, на полу. */
    ...pairs("prop_atm_01", ["prop_atm_02", "prop_atm_03"], WALL),
    /* Холодильники. */
    ["v_68_fridgefood>v_68_fridgedrinks", Object.freeze({ turn: 270, anchor: "centre" })],
    ["v_68_fridgedrinks>v_68_fridgefood", Object.freeze({ turn: 90, anchor: "centre" })],
    ...pairs("prop_bar_beerfridge_01", ["prop_bar_fridge_01"], WALL),
    ...pairs("prop_bar_fridge_02", ["prop_bar_fridge_04"], WALL),
    ...pairs("prop_bar_fridge_04", ["prop_bar_fridge_02"], WALL),
    /* Стулья и кресла. */
    ...["prop_chair_01b", "prop_chair_04a", "prop_chair_02"].flatMap((from) =>
      pairs(from, ["prop_chair_01a", "prop_chair_05", "prop_chair_06", "prop_chair_07", "prop_chair_09", "prop_chateau_chair_01"], CENTRE),
    ),
    ...pairs("v_corp_offchair", ["prop_off_chair_01", "prop_off_chair_05", "v_club_officechair"], CENTRE),
    ...pairs("v_corp_cd_chair", ["prop_off_chair_05"], CENTRE),
    ...pairs("v_corp_bk_chair3", ["prop_off_chair_05"], CENTRE),
    ...pairs("prop_gc_chair02", ["prop_off_chair_01", "prop_off_chair_05", "prop_direct_chair_01"], CENTRE),
    ...pairs("v_ret_gc_chair02", ["prop_direct_chair_01", "prop_off_chair_01"], CENTRE),
    ...pairs("v_ret_fh_chair01", ["prop_off_chair_01", "prop_direct_chair_01"], CENTRE),
    ...pairs("v_corp_lngestool", ["v_club_cc_stool"], CENTRE),
    /* Растения и вазы. */
    ...pairs("v_res_mvasechinese", ["v_res_rubberplant", "v_res_exoticvase"], CENTRE),
    ...pairs("prop_plant_int_01a", ["prop_plant_int_02a", "prop_plant_int_02b"], CENTRE),
    ...pairs("prop_plant_int_01b", ["prop_plant_int_02a", "prop_plant_int_02b"], CENTRE),
    ...pairs("prop_plant_int_02b", ["prop_plant_int_01a"], CENTRE),
    /* Картотеки. */
    ...["v_corp_filecabtall", "v_corp_filecabtall_01", "v_corp_bk_filecab"].flatMap((from) => pairs(from, ["prop_cabinet_02b"], WALL)),
  ]),
);

/** Пара «вещь → модель» или `null`, если такая замена не проверена. */
export const shopSwapPair = (from, to) => SHOP_SWAP_PAIRS[`${from}>${to}`] || null;

/* ------------------------------------------------------------------ *
 * Помещения: варианты групп и готовые интерьеры
 * ------------------------------------------------------------------ */

/* Отделка шаблонов — как у общих обликов (`SHOPS_PRESETS`). */
const solid = (hex) => ({ mode: "solid", colour: hex, colour2: "#ffffff", direction: "height", width: 2, shift: 0 });
const tone = (hex) => ({ mode: "colour", look: solid(hex) });
const flat = (hex) => ({ mode: "flat", look: solid(hex) });
const pattern = (id, colours, scale = 100) => ({ mode: "pattern", pattern: { id, colours, scale } });
const glow = (from, to) => ({ mode: "colour", look: { mode: "gradient", colour: from, colour2: to, direction: "along", width: 2, shift: 0 } });

const variant = (id, label, note, swaps) => Object.freeze({ id, label, note, swaps: Object.freeze(swaps) });
const template = (id, label, description, kits, surfaces, hidden = []) => Object.freeze({ id, label, description, kits: Object.freeze(kits), surfaces: Object.freeze(surfaces), hidden: Object.freeze(hidden) });
const allTo = (froms, to) => Object.fromEntries(froms.map((from) => [from, to]));

/* Причины «только цвет и текстуры» — одной фразой в панели «Предметы». */
const WHY_CLOTHES = "Стойки и витрины с одеждой собраны под стены этого зала: другая модель на их месте встала бы криво, поэтому здесь меняются только цвет и текстуры.";
const WHY_GUNS = "Стенды с оружием и витрины вписаны в стены зала, моделей того же размера у игры для них нет — здесь меняются только цвет и текстуры.";
const WHY_GARAGE = "Подъёмники, покрасочная камера и верстаки встроены в гараж, других моделей того же размера у игры нет — здесь меняются только цвет и текстуры.";

const SHOP247_VENDING = [
  variant("water", "Вода Raine", "Вместо кофейного автомата — автомат с водой", { prop_vend_coffe_01: "prop_vend_water_01" }),
  variant("ecola", "Холодильник eCola", "Вместо кофейного автомата — холодильник с газировкой", { prop_vend_coffe_01: "prop_vend_fridge01" }),
  variant("arcade", "Аркада", "Игровой автомат QUB3D и синий автомат жвачки", { prop_vend_coffe_01: "prop_arcade_01", prop_gumball_01: "prop_gumball_03" }),
  variant("retro", "Ретро", "Музыкальный автомат 50-х и маленький автомат жвачки", { prop_vend_coffe_01: "prop_50s_jukebox", prop_gumball_01: "prop_gumball_02" }),
];
const ATM_VARIANTS = [
  variant("blue", "Синий банкомат", "Настенный банкомат — задником к стене", { prop_atm_01: "prop_atm_02" }),
  variant("red", "Красный банкомат", "Настенный банкомат — задником к стене", { prop_atm_01: "prop_atm_03" }),
];
const BARBER_CHAIRS = ["prop_chair_01b", "prop_chair_04a", "prop_chair_02"];
const BAR_FRIDGES = [
  variant("glass", "Все со стеклом", "Барные холодильники со стеклянными дверцами", { prop_bar_fridge_02: "prop_bar_fridge_04" }),
  variant("solid", "Все глухие", "Барные холодильники с глухими дверцами", { prop_bar_fridge_04: "prop_bar_fridge_02" }),
];
const BANK_PLANTS = [
  variant("topiary", "Деревца-шары", "Подстриженные деревца в горшках", { prop_plant_int_01a: "prop_plant_int_02a", prop_plant_int_01b: "prop_plant_int_02a" }),
  variant("basket", "Деревца в корзинах", "Подстриженные деревца в плетёных корзинах", { prop_plant_int_01a: "prop_plant_int_02b", prop_plant_int_01b: "prop_plant_int_02b" }),
];
const FILES = ["v_corp_filecabtall", "v_corp_filecabtall_01", "v_corp_bk_filecab"];

export const SHOP_KITS = Object.freeze({
  shop247: {
    groups: { vending: SHOP247_VENDING, atm: ATM_VARIANTS },
    templates: [
      template("diner", "Ретро-дайнер", "Музыкальный автомат 50-х, красный банкомат, шахматный пол и сливочные стены", { vending: "retro", atm: "red" }, {
        walls: flat("#f1e6cc"),
        floor: pattern("checker", ["#f4f1ea", "#1d1d1f", "#9a9a9a"]),
        ceiling: flat("#fbf8f1"),
        counter: tone("#c8102e"),
      }),
      template("arcade", "Неон и аркада", "Игровой автомат, синий банкомат и жвачка, стены неоном, тёмный зал", { vending: "arcade", atm: "blue" }, {
        walls: glow("#2ee6ff", "#ff2e97"),
        floor: flat("#16161c"),
        ceiling: flat("#0f0f13"),
      }),
      template("fresh", "Свежесть", "Автомат с водой, синий банкомат, белые стены и светлая плитка", { vending: "water", atm: "blue" }, {
        walls: flat("#e9f2f7"),
        floor: pattern("tiles", ["#f5f9fb", "#dbe6ee", "#9fb3c2"]),
        ceiling: flat("#ffffff"),
      }),
      template("ecola", "eCola", "Холодильник eCola, красный банкомат, красные стены и терраццо", { vending: "ecola", atm: "red" }, {
        walls: tone("#c4161c"),
        floor: pattern("terrazzo", ["#ece6da", "#c4161c", "#2b2b2b"]),
        ceiling: flat("#f6f3ee"),
      }),
    ],
  },
  ltd: {
    groups: {
      vending: [
        variant("fixed", "Все работают", "Сломанный Sprunk — рабочий", { v_68_broeknvend: "prop_vend_soda_02" }),
        variant("drinks", "Только напитки", "Sprunk, eCola и холодильник eCola", { prop_vend_soda_01: "prop_vend_soda_02", v_68_broeknvend: "prop_vend_soda_01", prop_vend_coffe_01: "prop_vend_fridge01" }),
        variant("snacks", "Снеки и вода", "Автомат снеков, Sprunk и вода Raine", { prop_vend_soda_01: "prop_vend_snak_01", v_68_broeknvend: "prop_vend_soda_02", prop_vend_coffe_01: "prop_vend_water_01" }),
        variant("games", "Музыка и игры", "Музыкальный и игровой автоматы, жвачка другого цвета", {
          prop_vend_soda_01: "prop_jukebox_01",
          v_68_broeknvend: "prop_vend_soda_02",
          prop_vend_coffe_01: "prop_arcade_01",
          prop_gumball_01: "prop_gumball_03",
          prop_gumball_03: "prop_gumball_01",
        }),
      ],
      fridges: [
        variant("drinks", "Только напитки", "У стены с едой — тоже напитки", { v_68_fridgefood: "v_68_fridgedrinks" }),
        variant("food", "Только еда", "У стены с напитками — тоже еда", { v_68_fridgedrinks: "v_68_fridgefood" }),
        variant("swap", "Еда и напитки местами", "Стены холодильников меняются начинкой", { v_68_fridgefood: "v_68_fridgedrinks", v_68_fridgedrinks: "v_68_fridgefood" }),
      ],
      atm: ATM_VARIANTS,
    },
    templates: [
      template("night", "Ночная заправка", "Музыкальный и игровой автоматы, красный банкомат, стены неоном", { vending: "games", atm: "red" }, {
        walls: glow("#ff8a00", "#7b2cff"),
        floor: flat("#18181d"),
        ceiling: flat("#101014"),
      }),
      /* Вывески «Dairy, Chilled Foods» и «Cold Beer, Soft Drinks» — одна модель над обеими стенами: с одной начинкой у обеих стен она убрана. */
      template(
        "drinks",
        "Напитки 24/7",
        "Холодильники с напитками у обеих стен, газировка, синий банкомат; без вывесок и плакатов",
        { vending: "drinks", fridges: "drinks", atm: "blue" },
        {
          walls: flat("#eef3f6"),
          floor: pattern("tiles", ["#f5f9fb", "#dbe6ee", "#9fb3c2"]),
          ceiling: flat("#ffffff"),
        },
        ["signs"],
      ),
      template(
        "snack",
        "Снек-бар",
        "Автомат снеков и вода, еда у обеих стен, тёплые стены и терраццо; без вывесок и плакатов",
        { vending: "snacks", fridges: "food", atm: "red" },
        {
          walls: tone("#f28c28"),
          floor: pattern("terrazzo", ["#efe7d8", "#f28c28", "#2f5d7c"]),
          ceiling: flat("#fff7ec"),
        },
        ["signs"],
      ),
    ],
  },
  liquor: {
    groups: { fridges: [variant("wine", "Винные холодильники", "Холодильники с пивом — с вином", { prop_bar_beerfridge_01: "prop_bar_fridge_01" })] },
    templates: [
      template("wine", "Винный бутик", "Холодильники с вином, бордовые стены, дощатый пол", { fridges: "wine" }, {
        walls: tone("#6b1f2e"),
        floor: pattern("planks", ["#8a5a36", "#5a3920", "#2a1a0f"]),
        ceiling: flat("#efe4d2"),
      }),
      template("cellar", "Погребок", "Холодильники с вином, кирпичные стены, бетонный пол", { fridges: "wine" }, {
        walls: pattern("bricks", ["#7a3b26", "#4a2216", "#b8ab98"], 80),
        floor: pattern("concrete", ["#7a7874", "#555350", "#2e2d2b"]),
        ceiling: flat("#2a2522"),
      }),
    ],
  },
  binco: { why: WHY_CLOTHES },
  suburban: { why: WHY_CLOTHES },
  ponsonbys: { why: WHY_CLOTHES },
  ammunation: { why: WHY_GUNS },
  ammurange: {
    groups: {
      vending: [
        variant("swap", "eCola и Sprunk местами", "Автоматы газировки меняются местами", { prop_vend_soda_01: "prop_vend_soda_02", prop_vend_soda_02: "prop_vend_soda_01" }),
        variant("drinks", "Напитки", "Вместо кофе — холодильник eCola, вместо снеков — Sprunk", { prop_vend_coffe_01: "prop_vend_fridge01", prop_vend_snak_01: "prop_vend_soda_02" }),
        variant("snacks", "Снеки и вода", "Вместо eCola — снеки, вместо кофе — вода Raine", { prop_vend_soda_01: "prop_vend_snak_01", prop_vend_coffe_01: "prop_vend_water_01" }),
        variant("music", "Музыкальный автомат", "Вместо Sprunk — музыкальный автомат", { prop_vend_soda_02: "prop_jukebox_01" }),
      ],
      furniture: [variant("director", "Режиссёрские стулья", "Стулья в классе и у тира — складные режиссёрские", { v_ret_gc_chair02: "prop_direct_chair_01" })],
    },
    templates: [
      template("club", "Клуб стрелков", "Режиссёрские стулья, снеки и вода, дощатый пол", { vending: "snacks", furniture: "director" }, {
        walls: tone("#7a6a52"),
        floor: pattern("planks", ["#8a5a36", "#5a3920", "#2a1a0f"]),
        ceiling: flat("#e8e2d6"),
      }),
      template("tactical", "Тактический", "Напитки и музыкальный автомат, бетон и рифлёный металл", { vending: "drinks", furniture: "director" }, {
        walls: pattern("concrete", ["#8e8c88", "#62605c", "#353432"]),
        floor: pattern("diamond", ["#6d737a", "#6d737a", "#b8bec4"]),
        ceiling: flat("#3b3d40"),
      }),
    ],
  },
  barbers: {
    groups: {
      furniture: [
        variant("wood", "Деревянные стулья", "Стулья для ожидания — деревянные", allTo(BARBER_CHAIRS, "prop_chair_07")),
        variant("rattan", "Плетёные кресла", "Стулья для ожидания — плетёные кресла с подушками", allTo(BARBER_CHAIRS, "prop_chair_05")),
        variant("chateau", "Стулья «Шато»", "Стулья для ожидания — с полосатой обивкой", allTo(BARBER_CHAIRS, "prop_chateau_chair_01")),
        variant("aluminium", "Алюминиевые стулья", "Стулья для ожидания — алюминиевые", allTo(BARBER_CHAIRS, "prop_chair_01a")),
        variant("metal", "Металлические стулья", "Стулья для ожидания — металлические", allTo(BARBER_CHAIRS, "prop_chair_06")),
        variant("garden", "Садовые стулья", "Стулья для ожидания — зелёные садовые", allTo(BARBER_CHAIRS, "prop_chair_09")),
      ],
    },
    templates: [
      template("classic", "Классика", "Деревянные стулья, дощатый пол, тёплые стены", { furniture: "wood" }, {
        walls: tone("#b0895f"),
        floor: pattern("planks", ["#8a5a36", "#5a3920", "#2a1a0f"]),
        ceiling: flat("#efe4d2"),
      }),
      template("lounge", "Лаунж", "Плетёные кресла, тёмные стены, бетонный пол", { furniture: "rattan" }, {
        walls: flat("#2b2a2f"),
        floor: pattern("concrete", ["#6e6c68", "#4c4a47", "#2b2a28"]),
        ceiling: flat("#1c1c1f"),
      }),
      template("chateau", "Шато", "Стулья с полосатой обивкой, сливочные стены, мраморный пол", { furniture: "chateau" }, {
        walls: flat("#efe3cf"),
        floor: pattern("marble", ["#ece8e3", "#6d6a70", "#c9c4bf"]),
        ceiling: flat("#fbf8f1"),
      }),
      template("garden", "Сад", "Зелёные садовые стулья, мятные стены, терраццо", { furniture: "garden" }, {
        walls: flat("#cfe3d4"),
        floor: pattern("terrazzo", ["#ece6da", "#3f7f5a", "#2f5d7c"]),
        ceiling: flat("#f6f8f4"),
      }),
    ],
  },
  bobmulet: {
    groups: {
      furniture: [
        variant("leather", "Кожаное кресло", "Кресло администратора — кожаное", { v_corp_offchair: "v_club_officechair" }),
        variant("office", "Офисное кресло", "Кресло администратора — высокое офисное", { v_corp_offchair: "prop_off_chair_01" }),
        variant("mesh", "Кресло-сетка", "Кресло администратора — сетчатое", { v_corp_offchair: "prop_off_chair_05" }),
      ],
      plants: [
        variant("yellow", "Жёлтые цветы", "Ваза на стойке — с жёлтыми цветами", { v_res_mvasechinese: "v_res_rubberplant" }),
        variant("exotic", "Стрелиция", "Ваза на стойке — со стрелицией", { v_res_mvasechinese: "v_res_exoticvase" }),
      ],
    },
    templates: [
      template("lux", "Салон-люкс", "Кожаное кресло, стрелиция, мраморный пол и сливочные стены", { furniture: "leather", plants: "exotic" }, {
        walls: flat("#efe6d2"),
        floor: pattern("marble", ["#ece8e3", "#6d6a70", "#c9c4bf"]),
        ceiling: flat("#fbf8f1"),
      }),
      template("minimal", "Минимализм", "Кресло-сетка, жёлтые цветы, белые стены и светлая плитка", { furniture: "mesh", plants: "yellow" }, {
        walls: flat("#f2f1ee"),
        floor: pattern("tiles", ["#f4f1ea", "#e4ddd0", "#a8a294"]),
        ceiling: flat("#ffffff"),
      }),
    ],
  },
  lscustoms: { why: WHY_GARAGE },
  lscustoms68: { why: WHY_GARAGE },
  lscustomslm: { why: WHY_GARAGE },
  fleeca: {
    groups: {
      plants: BANK_PLANTS,
      furniture: [
        variant("files", "Белые картотеки", "Серые картотеки — белые", allTo(FILES, "prop_cabinet_02b")),
        variant("chairs", "Кресла-сетка", "Стулья посетителей — сетчатые кресла", { v_corp_cd_chair: "prop_off_chair_05" }),
        variant("modern", "Белые картотеки и кресла-сетка", "Картотеки и стулья посетителей разом", { ...allTo(FILES, "prop_cabinet_02b"), v_corp_cd_chair: "prop_off_chair_05" }),
      ],
    },
    templates: [
      template("green", "Зелёный офис", "Деревца-шары, белые картотеки и кресла-сетка, светлые стены", { plants: "topiary", furniture: "modern" }, {
        walls: tone("#d9e3d4"),
        floor: pattern("planks", ["#b48a5a", "#8a6440", "#4a3420"]),
        ceiling: flat("#ffffff"),
      }),
      template("classic", "Классический банк", "Деревца в корзинах, белые картотеки, зелёные стены и мрамор", { plants: "basket", furniture: "files" }, {
        walls: tone("#2f6b45"),
        floor: pattern("marble", ["#ece8e3", "#6d6a70", "#c9c4bf"]),
        ceiling: flat("#f6f3ee"),
      }),
    ],
  },
  pacific: {
    groups: {
      plants: BANK_PLANTS,
      furniture: [
        variant("files", "Белые картотеки", "Серые картотеки — белые", allTo(FILES, "prop_cabinet_02b")),
        variant("mesh", "Кресла-сетка", "Стулья менеджеров — сетчатые кресла", { v_corp_bk_chair3: "prop_off_chair_05" }),
        variant("modern", "Белые картотеки и кресла-сетка", "Картотеки и стулья менеджеров разом", { ...allTo(FILES, "prop_cabinet_02b"), v_corp_bk_chair3: "prop_off_chair_05" }),
      ],
    },
    templates: [
      template("modern", "Современный банк", "Деревца-шары, белые картотеки, кресла-сетка, светлый мрамор", { plants: "topiary", furniture: "modern" }, {
        walls: flat("#efede8"),
        floor: pattern("marble", ["#f0ece6", "#8a8790", "#d3cec8"]),
        ceiling: flat("#ffffff"),
      }),
      template("gold", "Золото и камень", "Деревца в корзинах, белые картотеки, тёмный мрамор", { plants: "basket", furniture: "files" }, {
        walls: tone("#b08d57"),
        floor: pattern("marble", ["#2b2a2e", "#c9a45a", "#4a484e"]),
        ceiling: flat("#f6f1e6"),
      }),
    ],
  },
  blaine: {
    groups: {
      plants: [variant("topiary", "Деревца-шары", "Растения в горшках — подстриженные деревца", { prop_plant_int_01b: "prop_plant_int_02a" }), variant("basket", "Деревца в корзинах", "Растения — деревца в плетёных корзинах", { prop_plant_int_01b: "prop_plant_int_02b" })],
      furniture: [variant("leather", "Кожаное кресло", "Кресло управляющего — кожаное", { v_corp_offchair: "v_club_officechair" }), variant("mesh", "Кресло-сетка", "Кресло управляющего — сетчатое", { v_corp_offchair: "prop_off_chair_05" })],
    },
    templates: [
      template("country", "Деревенский банк", "Деревца в корзинах, кожаное кресло, доски и тёплые стены", { plants: "basket", furniture: "leather" }, {
        walls: tone("#a0745a"),
        floor: pattern("planks", ["#8a5a36", "#5a3920", "#2a1a0f"]),
        ceiling: flat("#efe4d2"),
      }),
      template("office", "Светлый офис", "Деревца-шары, кресло-сетка, светлые стены и плитка", { plants: "topiary", furniture: "mesh" }, {
        walls: flat("#f0f0ec"),
        floor: pattern("tiles", ["#f4f1ea", "#e4ddd0", "#a8a294"]),
        ceiling: flat("#ffffff"),
      }),
    ],
  },
  unicorn: {
    groups: {
      fridges: BAR_FRIDGES,
      plants: [variant("bushes", "Пышные растения", "Деревца в корзинах — пышные растения", { prop_plant_int_02b: "prop_plant_int_01a" })],
    },
    templates: [
      template("glass", "Витрина бара", "Барные холодильники со стеклом, пышные растения, стены неоном", { fridges: "glass", plants: "bushes" }, {
        walls: glow("#ff2e97", "#7b2cff"),
      }),
      template("dark", "Тёмный клуб", "Глухие барные холодильники, тёмные стены и потолок", { fridges: "solid" }, {
        walls: flat("#1d1b22"),
        ceiling: flat("#0f0e12"),
      }),
    ],
  },
  bahama: {
    groups: {
      fridges: BAR_FRIDGES,
      furniture: [variant("stools", "Красные табуреты", "Пуфы у столиков — красные табуреты", { v_corp_lngestool: "v_club_cc_stool" })],
    },
    templates: [
      template("tropic", "Тропики", "Барные холодильники со стеклом, красные табуреты, бирюзовые стены", { fridges: "glass", furniture: "stools" }, {
        walls: glow("#00c2c7", "#2f80ed"),
      }),
      template("night", "Ночной бар", "Глухие барные холодильники, тёмные стены", { fridges: "solid" }, {
        walls: flat("#141a2b"),
        ceiling: flat("#0b0e17"),
      }),
    ],
  },
  splitsides: {
    groups: { fridges: [variant("glass", "Со стеклом", "Холодильники под стойкой — со стеклянными дверцами", { prop_bar_fridge_02: "prop_bar_fridge_04" })] },
    /*
     * У Split Sides столешница стойки — тот же лист, что стены, а её перед — тот
     * же, что пол: узор лёг бы и на стойку. Поэтому здесь — только тон цвета.
     */
    templates: [
      template("club", "Клубная классика", "Холодильники со стеклом, винно-красные стены, тёмный потолок", { fridges: "glass" }, {
        walls: tone("#6b2430"),
        ceiling: flat("#1a1416"),
      }),
      template("dark", "Тёмный зал", "Холодильники со стеклом, тёмные стены и потолок", { fridges: "glass" }, {
        walls: flat("#1d1b22"),
        ceiling: flat("#121116"),
      }),
    ],
  },
  tattoo: {
    groups: {
      furniture: [
        variant("office", "Офисные кресла", "Стулья для ожидания — офисные кресла", { prop_gc_chair02: "prop_off_chair_01" }),
        variant("mesh", "Кресла-сетка", "Стулья для ожидания — сетчатые кресла", { prop_gc_chair02: "prop_off_chair_05" }),
        variant("director", "Режиссёрские стулья", "Стулья для ожидания — складные режиссёрские", { prop_gc_chair02: "prop_direct_chair_01" }),
      ],
      vending: [variant("red", "Красный автомат жвачки", "Синий автомат жвачки — красный на два шара", { prop_gumball_03: "prop_gumball_01" })],
    },
    templates: [
      template("studio", "Студия", "Кресла-сетка, белые стены, бетонный пол", { furniture: "mesh" }, {
        walls: flat("#f1f0ed"),
        floor: pattern("concrete", ["#9a9894", "#6c6a66", "#3b3a38"]),
        ceiling: flat("#ffffff"),
      }),
      template("oldschool", "Олдскул", "Режиссёрские стулья, красный автомат жвачки, кирпич и шахматный пол", { furniture: "director", vending: "red" }, {
        walls: pattern("bricks", ["#9c4a32", "#6e2f1f", "#cfc6b8"], 80),
        floor: pattern("checker", ["#f0f0f0", "#1d1d1f", "#9a9a9a"]),
      }),
    ],
  },
  tattoo2: {
    groups: {
      furniture: [
        variant("office", "Офисные кресла", "Стулья — офисные кресла", { v_ret_fh_chair01: "prop_off_chair_01", v_ret_gc_chair02: "prop_off_chair_01" }),
        variant("director", "Режиссёрские стулья", "Стулья — складные режиссёрские", { v_ret_fh_chair01: "prop_direct_chair_01", v_ret_gc_chair02: "prop_direct_chair_01" }),
      ],
    },
    templates: [
      template("studio", "Студия", "Офисные кресла, белые стены, бетонный пол", { furniture: "office" }, {
        walls: flat("#f1f0ed"),
        floor: pattern("concrete", ["#9a9894", "#6c6a66", "#3b3a38"]),
        ceiling: flat("#ffffff"),
      }),
      template("garage", "Гаражный салон", "Режиссёрские стулья, кирпичные стены, дощатый пол", { furniture: "director" }, {
        walls: pattern("bricks", ["#7a3b26", "#4a2216", "#b8ab98"], 80),
        floor: pattern("planks", ["#8a5a36", "#5a3920", "#2a1a0f"]),
      }),
    ],
  },
});

/** Варианты вещей и готовые интерьеры помещения: `{ groups, templates, why }`. */
export function shopKitsOf(interiorId) {
  const kits = SHOP_KITS[interiorId];
  return { groups: kits?.groups || {}, templates: kits?.templates || [], why: kits?.why || "" };
}

/**
 * Модели, на которые в помещении можно заменить вещь модели `model`: из его
 * вариантов групп, только проверенные пары — в порядке вариантов.
 */
export function shopSwapTargets(interiorId, model) {
  const out = [];
  for (const variants of Object.values(shopKitsOf(interiorId).groups))
    for (const entry of variants) {
      const to = entry.swaps?.[model];
      if (to && to !== model && shopSwapPair(model, to) && !out.includes(to)) out.push(to);
    }
  return out;
}
