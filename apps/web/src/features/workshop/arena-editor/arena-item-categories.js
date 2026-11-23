/*
 * Категории предметов арены для панели «Предметы» (ТЗ владельца 26.10.2026, п. A1): «Мониторы, Кресла, Кубки,
 * Аирдропы, Экраны, Плакаты, Перила, Стулья…» — так, как человек называет вещи зала, а не по родам описи
 * (`arenaObjectKind` годится для значка и порядка, а «стул» и «кресло» у него один род). Категория берётся по имени
 * модели игры или сервера; не нашлась — по роду, дальше «Прочее». Оболочка зала (стены, пол, потолок, двери здания)
 * стоит отдельно и последней перед «Прочим»: её красят, но не убирают.
 *
 * Чистые функции: подписи — ключи словаря (переводит место отрисовки), комнаты — по описи (`arenaObjectInterior`).
 */

import { arenaObjectInterior } from "@modovik/climb-contract/recolor/arena-objects";

export const ARENA_ITEM_CATEGORIES = Object.freeze([
  { id: "monitors", label: "Мониторы", one: "Монитор" },
  { id: "screens", label: "Экраны и телевизоры", one: "Экран" },
  { id: "seats", label: "Кресла и диваны", one: "Кресло" },
  { id: "chairs", label: "Стулья", one: "Стул" },
  { id: "trophies", label: "Кубки и награды", one: "Кубок" },
  { id: "airdrops", label: "Аирдропы", one: "Аирдроп" },
  { id: "cube", label: "Cube World и Battle Royale", one: "Предмет Cube World" },
  { id: "posters", label: "Плакаты и вывески", one: "Плакат" },
  { id: "rails", label: "Перила и ограждения", one: "Ограждение" },
  { id: "kiosks", label: "Киоски", one: "Киоск" },
  { id: "tables", label: "Столы и подставки", one: "Стол" },
  { id: "tech", label: "Техника и автоматы", one: "Техника" },
  { id: "light", label: "Светильники", one: "Светильник" },
  { id: "plants", label: "Растения", one: "Растение" },
  { id: "doors", label: "Двери", one: "Дверь" },
  { id: "food", label: "Еда и напитки", one: "Еда" },
  { id: "shell", label: "Стены, пол и потолок", one: "Оболочка" },
  { id: "decor", label: "Прочее", one: "Предмет" },
]);

const ONE = new Map(ARENA_ITEM_CATEGORIES.map((category) => [category.id, category.one]));

/* Правила по имени модели: первое совпавшее. Порядок важен: «монитор» раньше «экрана», «стул» раньше «кресла». */
const NAME_RULES = Object.freeze([
  ["airdrops", /airdrop/],
  ["cube", /(^|_)mn_|cbwrld|brstand/],
  /* Киоск зала GTA 5 RP назван по вывеске-меню на нём (`xj_pos_smallscreen`): это киоск, а не экран. */
  ["kiosks", /(^|_)pos_smallscreen/],
  ["monitors", /gamingmonitor|monitor|screen_touch|tablet|dubg_maptable/],
  ["screens", /longscreen|circle_screen|fake_screen|(^|_)tv(_|$)|tvscreen|screen_(tnt|rnx)|(^|_)screen$|smallscreen/],
  ["chairs", /chair|stool|bench/],
  ["trophies", /trophy|(^|_)cup(_|$)|cup_stand|helmet|racer_cup/],
  ["posters", /poster|banner|(^|_)flags?(_|\d|$)|logo|racing_sign|restroomsign|fameorshame|fos_star|(^|_)sign(_|$)|table_sign|painting|photo/],
  ["rails", /barrier|rope|(^|_)rail|fence|bollard|(^|_)rubber$/],
]);

/** Категория модели описи (`{ name, kind, shell }`): id из `ARENA_ITEM_CATEGORIES`. */
export function arenaItemCategory(model) {
  if (model.shell || model.kind === "structure") return "shell";
  const name = String(model.name || "").toLowerCase();
  for (const [id, rule] of NAME_RULES) if (rule.test(name)) return id;
  switch (model.kind) {
    case "screen":
      return "screens";
    case "seat":
      return "seats";
    case "table":
      return "tables";
    case "tech":
      return "tech";
    case "light":
      return "light";
    case "plant":
      return "plants";
    case "door":
      return "doors";
    case "food":
      return "food";
    case "trophy":
      return "trophies";
    default:
      return "decor";
  }
}

/** Что за предмет в единственном числе («Монитор», «Стул»…): ключ словаря. */
export const arenaItemCategoryOne = (id) => ONE.get(id) || "Предмет";

/*
 * Имя модели для человека — по её внутреннему имени, где оно говорит само за себя (`longscreen_a` — длинный экран A,
 * `trophy_cup` — кубок, `chairstrip` — ряд стульев). Прочим — имя категории в единственном числе: их различает кадр.
 * `[ключ словаря, …вставки]`, ключ переводит место отрисовки; вставка `{0}` — буква или цифра из имени модели.
 */
const TITLES = Object.freeze([
  [/longscreen_([a-z])$/, (match) => ["Длинный экран {0}", match[1].toUpperCase()]],
  [/(^|_)tv_([a-z])$/, (match) => ["Телевизор {0}", match[2].toUpperCase()]],
  [/screen_touch|tablet/, () => ["Планшет"]],
  [/gamingmonitor_solo/, () => ["Игровой монитор (одиночный)"]],
  [/gamingmonitor/, () => ["Игровой монитор"]],
  [/festival_monitor/, () => ["Монитор фестиваля"]],
  [/circle_screen/, () => ["Круглый экран"]],
  [/cup_stand/, () => ["Подставка для кубка"]],
  [/racer_cup/, () => ["Кубок гонщика"]],
  [/trophy_racer/, () => ["Трофей гонщика"]],
  [/trophy_cup|(^|_)cup(_|$)/, () => ["Кубок"]],
  [/helmet/, () => ["Шлем"]],
  [/airdrop/, () => ["Аирдроп"]],
  [/mn_house/, () => ["Домик Cube World"]],
  [/brstand/, () => ["Домик Battle Royale"]],
  [/mn_chest/, () => ["Сундук"]],
  [/mn_crft/, () => ["Верстак"]],
  [/mn_frns/, () => ["Печь"]],
  [/mn_table/, () => ["Стол Cube World"]],
  [/mn_light/, () => ["Светильник Cube World"]],
  [/cbwrld/, () => ["Надпись Cube World"]],
  [/barrier_rope/, () => ["Бархатное ограждение"]],
  [/barrierpost/, () => ["Перила"]],
  [/(^|_)rubber$/, () => ["Коврики у перил"]],
  [/pos_smallscreen/, () => ["Киоск"]],
  [/(^|_)wood07$/, () => ["Лестница"]],
  [/rope_hook/, () => ["Крюк ограждения"]],
  [/chairstrip/, () => ["Ряд стульев"]],
  [/plastchair/, () => ["Пластиковый стул"]],
  [/officechair/, () => ["Офисное кресло"]],
  [/sofa/, () => ["Диван"]],
  [/palm/, () => ["Пальма"]],
  /* `prop_fbibombplant` — бомба, а не растение: «plant» в имени — «заложить». */
  [/bombplant/, () => ["Бомба"]],
  [/plant|planter/, () => ["Растение"]],
  [/ceilingspeaker/, () => ["Потолочный динамик"]],
  [/keyboard/, () => ["Клавиатура"]],
  [/mouse/, () => ["Мышь"]],
  [/pctower/, () => ["Системный блок"]],
  [/laptop/, () => ["Ноутбук"]],
  [/(^|_)atm_|cashpoint/, () => ["Банкомат"]],
  [/vend_/, () => ["Торговый автомат"]],
  [/arcade/, () => ["Аркадный автомат"]],
  [/djset/, () => ["DJ-пульт"]],
  [/projector/, () => ["Проектор"]],
  [/coridor_lamps/, () => ["Лампы коридора"]],
  [/celling?lamp|ceilinglamp/, () => ["Потолочная лампа"]],
  [/candles/, () => ["Свечи"]],
  [/torch/, () => ["Факел"]],
  [/logo_cyberarena/, () => ["Логотип Cyber Arena"]],
  [/racing_sign/, () => ["Вывеска гоночной зоны"]],
  [/table_sign/, () => ["Табличка на столе"]],
  [/tab_coffee/, () => ["Журнальный столик"]],
  [/tab_sidelrg/, () => ["Столик"]],
  [/fire_hosebox/, () => ["Пожарный шкаф"]],
  [/crate_stack/, () => ["Стопка ящиков"]],
]);

/*
 * Вещи залов GTA 5 RP и Majestic, что раньше звались общим «Предмет» или «Дверь» (критик 30.10.2026, «Слои»): чем вещь является. Свой список,
 * а не `TITLES`: тем пользуются и интерьеры Majestic (`arenaModelTitleRule`), а у них свои имена. Одинаковые имена в списке различает номер по
 * порядку (`numberedTitles`), а не «Предмет 14».
 */
const HALL_TITLES = Object.freeze([
  [/xj_v_tvs$/, () => ["Телевизоры"]],
  [/tvscreen/, () => ["Телевизор"]],
  [/park_ticket/, () => ["Паркомат"]],
  [/liftbutton/, () => ["Кнопка лифта"]],
  [/lift_overlay/, () => ["Панель лифта"]],
  [/elevator/, () => ["Лифт"]],
  [/plastic_black/, () => ["Пластиковая панель"]],
  [/(^|_)bin_/, () => ["Урна"]],
  [/shutter/, () => ["Рольставня"]],
  [/metal_black/, () => ["Металлическая панель"]],
  [/givemechecker/, () => ["Шахматный узор"]],
  [/fire_exting/, () => ["Огнетушитель"]],
  [/_brand\d*$/, () => ["Рекламная вывеска"]],
  [/stad_shad/, () => ["Тень трибун"]],
  [/_ao\d/, () => ["Затенение"]],
  [/recycle_concrete/, () => ["Бетонный блок"]],
  [/fameorshamebanner/, () => ["Баннер Fame or Shame"]],
  [/fos_star/, () => ["Звезда Fame or Shame"]],
  [/mazered/, () => ["Красный декор Maze Bank"]],
  [/mazestad/, () => ["Трибуны"]],
  [/restroomsign/, () => ["Табличка туалета"]],
  [/(^|_)flags/, () => ["Флаги"]],
  [/doorcover/, () => ["Обшивка двери"]],
  [/enterdec/, () => ["Декор входа"]],
  [/doordecor/, () => ["Декор двери"]],
  [/door/, () => ["Дверь"]],
  [/seats_wall/, () => ["Сиденья у стены"]],
  [/seat_long/, () => ["Длинная скамья"]],
  [/round_seats|circle_seats/, () => ["Круглые сиденья"]],
  [/(^|_)seats(_all)?$/, () => ["Ряды кресел"]],
  [/armchair/, () => ["Кресло"]],
  [/light_big/, () => ["Большой светильник"]],
  [/bakelight/, () => ["Задняя подсветка"]],
  [/lamp_decor/, () => ["Декоративная лампа"]],
  [/(^|_)li?ght$/, () => ["Подсветка"]],
  [/shopping_bag|carrier_bag/, () => ["Пакет"]],
  [/coffeecup|_coffee$/, () => ["Кофе"]],
  [/bs_bag|food_bag/, () => ["Пакет с едой"]],
  [/(^|_)can(_|$)/, () => ["Банка газировки"]],
  [/big_bag/, () => ["Большая сумка"]],
  [/juice/, () => ["Сок"]],
  [/pot_fry/, () => ["Фритюрница"]],
  [/napkin/, () => ["Салфетки"]],
  [/beer_bottle/, () => ["Бутылка пива"]],
  [/handbag/, () => ["Сумка"]],
  [/phone_ing/, () => ["Телефон"]],
  [/table_mic/, () => ["Микрофон"]],
  [/cor_decor/, () => ["Декор коридора"]],
  [/mcl_props/, () => ["Гоночный реквизит"]],
  [/gun_zone/, () => ["Реквизит тира"]],
  [/gamingbox/, () => ["Игровая кабина"]],
  [/_scene$/, () => ["Сцена"]],
  [/glass_vitrine/, () => ["Витрина"]],
  [/racer_helm/, () => ["Шлем гонщика"]],
  [/_racer$/, () => ["Фигура гонщика"]],
  [/opwhl/, () => ["Болид"]],
  [/car_hooks/, () => ["Крюки для машины"]],
  [/screen_(tnt|rnx)/, (match) => ["Экран {0}", match[1].toUpperCase()]],
  [/fake_screen|(^|_)screen$/, () => ["Экран"]],
  [/circle_tables/, () => ["Круглые столы"]],
  [/mn_(ga|pa|sw)$/, () => ["Фигура Cube World"]],
  [/maptable/, () => ["Стол с картой"]],
  [/vase_flowers/, () => ["Ваза с цветами"]],
  [/(^|_)dec(or)?(_[a-z0-9]+)?$|wp_recth/, () => ["Декор"]],
]);

/** Все шаблоны имён моделей (ключи словаря) — для сверки перевода. */
export const arenaModelTitleTemplates = () => [...TITLES, ...HALL_TITLES].map(([, make]) => make(["", "A", "A"])[0]);

/** Имя модели по таблице имён: `[ключ словаря, …вставки]` или `null`, если модели в таблице нет (интерьеры тогда называют её внутренним именем). */
export function arenaModelTitleRule(model) {
  const name = String(model.name || "").toLowerCase();
  for (const [rule, make] of TITLES) {
    const match = rule.exec(name);
    if (match) return make(match);
  }
  return null;
}

export function arenaModelTitleParts(model) {
  /* Оболочка зала (стены, двери здания, лифты) — своими словами «Предметов» («Оболочка», часть), имена вещей зала ей не даются. */
  const shell = arenaItemCategory(model) === "shell";
  return arenaModelTitleRule(model) || (shell ? null : hallTitleRule(model)) || [arenaItemCategoryOne(arenaItemCategory(model))];
}

/* Имя вещи зала по `HALL_TITLES` или `null`. */
function hallTitleRule(model) {
  const name = String(model.name || "").toLowerCase();
  for (const [rule, make] of HALL_TITLES) {
    const match = rule.exec(name);
    if (match) return make(match);
  }
  return null;
}

/**
 * Имена строк списка (`[{ model, title }]` по порядку): у одинаковых — номер по порядку («Дверь 1», «Дверь 2»), у единственных — как есть.
 * Вставка числа — после имени на всех языках.
 */
export function numberedTitles(rows) {
  const total = new Map();
  for (const row of rows) total.set(row.title, (total.get(row.title) || 0) + 1);
  const seen = new Map();
  return rows.map((row) => {
    if (total.get(row.title) < 2) return row;
    const index = (seen.get(row.title) || 0) + 1;
    seen.set(row.title, index);
    return { ...row, title: `${row.title} ${index}` };
  });
}

/*
 * Комнаты зала для человека. Majestic: помещение 3 — главное, в нём коридор с экранами, круглый зал, игровая и гоночная
 * зоны (названия берёт опись мест: «длинные экраны коридора», «круглый экран над залом», «вывеска гоночной зоны»,
 * домики Cube World и Battle Royale). Прочие помещения и зал GTA 5 RP — по номеру, как в списке прежде.
 */
export const ARENA_ROOM_NAMES = Object.freeze({
  "3|coridor": "Коридор",
  "3|room2": "Круглый зал",
  "3|room3": "Игровая зона",
  "3|room4": "Гоночная зона",
});

/** Идентификатор комнаты вещи: `помещение|комната` (у зала GTA 5 RP — одно помещение игры). */
export const arenaRoomOf = (item) => `${arenaObjectInterior(item.key)}|${item.room || ""}`;

/** Порядок комнат: по номеру помещения, потом по комнате (коридор — до круглого зала). */
export function arenaRoomOrder(id) {
  const [interior, room = ""] = String(id).split("|");
  const number = Number(/(\d+)$/.exec(room)?.[1] || (room === "coridor" ? 1 : 0));
  return Number(interior) * 100 + number;
}

/**
 * Подпись комнаты. `translate(ключ)` — перевод места отрисовки (`tr`), `fill(ключ, значения…)` — подстановка в нём.
 * У зала GTA 5 RP помещения нет: «Зал арены», комнаты MLO — «Комната N».
 */
export function arenaRoomLabel(id, translate, fill) {
  const [interior, room = ""] = String(id).split("|");
  if (ARENA_ROOM_NAMES[id]) return translate(ARENA_ROOM_NAMES[id]);
  const number = /^room(\d+)$/.exec(room)?.[1] ?? /^GtaMloRoom0*(\d+)$/i.exec(room)?.[1] ?? null;
  const place = interior === "0" ? null : fill("Помещение {0}", interior);
  if (!place) return number ? fill("Комната {0}", number) : translate("Зал арены");
  if (!room || room === "limbo") return place;
  if (room === "coridor") return `${place} · ${translate("коридор")}`;
  return number ? `${place} · ${fill("комната {0}", number)}` : `${place} · ${room}`;
}
