const freeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};

export const INTERIOR_CATALOG_REVISION = "legacy-24129523-v1";

export const INTERIOR_TEMPLATES = freeze([
  {
    id: "convenience-store-small",
    version: 1,
    family: "store",
    label: "Небольшой магазин",
    room: {
      minX: -2.4835,
      maxX: 9.0245,
      minY: -5.576,
      maxY: 1.9359,
      minZ: 0,
      maxZ: 3.5563,
    },
    protectedVolumes: [
      {
        id: "entrance",
        label: "Вход и двери",
        minX: 0.15,
        maxX: 3.65,
        minY: -5.75,
        maxY: -4.65,
      },
    ],
    budgets: { entities: 128, uniqueProps: 32 },
  },
  {
    id: "gas-station-store-small",
    version: 1,
    family: "gas-station",
    label: "Магазин при заправке",
    room: {
      minX: -3.8674,
      maxX: 10.6032,
      minY: -5.6252,
      maxY: 2.7684,
      minZ: 0,
      maxZ: 3.5563,
    },
    protectedVolumes: [
      {
        id: "entrance",
        label: "Вход и двери",
        minX: 0.15,
        maxX: 3.75,
        minY: -5.75,
        maxY: -4.6,
      },
    ],
    budgets: { entities: 128, uniqueProps: 32 },
  },
]);

export const INTERIOR_LOCATIONS = freeze([
  {
    id: "shop-247-sc1-03",
    templateId: "convenience-store-small",
    templateVersion: 1,
    family: "store",
    label: "24/7 · Strawberry",
    region: "Los Santos",
    evidenceStatus: "build-verified",
    installable: false,
    supportedEditions: ["legacy"],
    supportedBuildIds: ["24129523"],
    worldTransform: {
      position: { x: 27.248524, y: -1343.679, z: 28.49696 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
    evidence: {
      archive: "x64k.rpf",
      entry:
        "levels/gta5/_citye/scentral_01/scentral_metadata.rpf/sc1_03_interior_v_shop_247_milo_.ymap",
      sha256:
        "618d350cc9d839deead40fbd1c7d277d3ba3e51a415a9731bfdf2371f4412487",
      archetypeHash: "0x9b39307b",
    },
  },
  {
    id: "shop-247-cs2-11",
    templateId: "convenience-store-small",
    templateVersion: 1,
    family: "store",
    label: "24/7 · Paleto Bay",
    region: "Blaine County",
    evidenceStatus: "build-verified",
    installable: false,
    supportedEditions: ["legacy"],
    supportedBuildIds: ["24129523"],
    worldTransform: {
      position: { x: 1731.9592, y: 6417.2437, z: 34.03717 },
      rotation: { x: 0, y: 0, z: -0.22800407, w: 0.9736602 },
    },
    evidence: {
      archive: "x64r.rpf",
      entry:
        "levels/gta5/_hills/country_02/country_02_metadata.rpf/cs2_11_interior_v_shop_247_milo_.ymap",
      sha256:
        "16430c75b4f900c73cd57e180b4ab89add5b4e8dd6458e5218115a1908540a02",
      archetypeHash: "0x9b39307b",
    },
  },
  {
    id: "gasstation-id2-21-b",
    templateId: "gas-station-store-small",
    templateVersion: 1,
    family: "gas-station",
    label: "LTD · Mirror Park",
    region: "Los Santos",
    evidenceStatus: "build-verified",
    installable: false,
    supportedEditions: ["legacy"],
    supportedBuildIds: ["24129523"],
    worldTransform: {
      position: { x: 1156.7665, y: -321.44058, z: 68.20503 },
      rotation: { x: 0, y: 0, z: 0.08715597, w: 0.9961947 },
    },
    evidence: {
      archive: "x64j.rpf",
      entry:
        "levels/gta5/_citye/indust_02/indust_02_metadata.rpf/id2_21_b_interior_v_gasstation_milo_.ymap",
      sha256:
        "97333dd564525d7fff6be0b41cbe107391c9972e1e19aa822ffdc885375881ef",
      archetypeHash: "0x568aee01",
    },
  },
  {
    id: "gasstation-sc1-21",
    templateId: "gas-station-store-small",
    templateVersion: 1,
    family: "gas-station",
    label: "LTD · Davis",
    region: "Los Santos",
    evidenceStatus: "build-verified",
    installable: false,
    supportedEditions: ["legacy"],
    supportedBuildIds: ["24129523"],
    worldTransform: {
      position: { x: -50.868835, y: -1751.0383, z: 28.420937 },
      rotation: { x: 0, y: 0, z: -0.34213108, w: 0.9396522 },
    },
    evidence: {
      archive: "x64k.rpf",
      entry:
        "levels/gta5/_citye/scentral_01/scentral_metadata.rpf/sc1_21_interior_v_gasstation_milo_.ymap",
      sha256:
        "32a30139af026ec72bca6997859becbdbc6184cdcd728bdfedda1564cb07c506",
      archetypeHash: "0x568aee01",
    },
  },
]);

/*
 * ДВА РАЗНЫХ ФАКТА О РАЗМЕРЕ, И ОНИ НЕ ВСЕГДА СОВПАДАЮТ
 *
 * `bbMin`/`bbMax` — коробка архетипа, СЛОВО САМОЙ ИГРЫ: числа скопированы из
 * `.ytyp`, на который ссылается `source`, и менять их нельзя, иначе ссылка
 * перестанет подтверждать строку. Отсюда же берётся `floorOffset` — насколько
 * начало координат модели ниже её низа.
 *
 * `bounds` — сколько места предмет занимает В КОМНАТЕ: по нему считается
 * пересечение с соседом, выход за стену и заход в защищённую зону
 * (`validation.js`), по нему же рисуется заглушка и рамка выделения.
 *
 * Обычно это одно и то же число, и `bounds` просто выводится из коробки. Но у
 * Rockstar коробка архетипа местами с большим запасом, и тогда правда одна не
 * заменяет другую: предмет ЗАПИСАН большим, а СТОИТ маленьким. На такой случай
 * есть `footprint` — замер по самой модели, который перебивает ширину и
 * глубину. Высоту он не трогает: по вертикали расхождений не нашлось, а
 * `floorOffset` завязан на `bbMin.z` и обязан остаться словом игры.
 *
 * `footprint` — не лазейка «подогнать на глаз». Он допустим только с замером
 * конкретного файла из архива, названным рядом со строкой.
 */
const prop = ({
  id,
  label,
  category,
  archetype,
  archetypeHash,
  bbMin,
  bbMax,
  footprint = null,
  color,
  cost = 1,
  source,
}) => ({
  id,
  label,
  category,
  bounds: {
    width: footprint ? footprint.width : bbMax.x - bbMin.x,
    depth: footprint ? footprint.depth : bbMax.y - bbMin.y,
    height: bbMax.z - bbMin.z,
  },
  bbMin,
  bbMax,
  floorOffset: -bbMin.z,
  color,
  surface: "floor",
  fixedScale: 1,
  evidenceStatus: "build-verified",
  archetype,
  archetypeHash,
  source,
  cost,
});

export const INTERIOR_PROPS = freeze([
  prop({
    id: "vending-drink",
    label: "Автомат eCola",
    category: "Автоматы",
    archetype: "prop_vend_soda_01",
    archetypeHash: "0x3b21c5e7",
    bbMin: { x: -0.503182, y: -0.473903, z: -0.952678 },
    bbMax: { x: 0.501645, y: 0.460195, z: 0.952574 },
    color: "#c45f67",
    cost: 4,
    source: "x64i.rpf/v_coin_op.ytyp@24129523",
  }),
  prop({
    id: "vending-drink-blue",
    label: "Автомат Sprunk",
    category: "Автоматы",
    archetype: "prop_vend_soda_02",
    archetypeHash: "0x426a547c",
    bbMin: { x: -0.502413, y: -0.473212, z: -0.952626 },
    bbMax: { x: 0.502414, y: 0.473211, z: 0.952626 },
    color: "#4f8fb8",
    cost: 4,
    source: "x64i.rpf/v_coin_op.ytyp@24129523",
  }),
  prop({
    id: "cooler-single",
    label: "Барный холодильник",
    category: "Холодильники",
    archetype: "prop_bar_fridge_01",
    archetypeHash: "0xe4b0ae85",
    bbMin: { x: -0.418179, y: -0.299095, z: -0.01045 },
    bbMax: { x: 0.41818, y: 0.299095, z: 2.161334 },
    color: "#68a8c0",
    cost: 4,
    source: "x64i.rpf/v_bar.ytyp@24129523",
  }),
  prop({
    id: "trash-bin",
    label: "Урна",
    category: "Инвентарь",
    archetype: "prop_bin_05a",
    archetypeHash: "0x4f3fa437",
    bbMin: { x: -0.389632, y: -0.389632, z: -0.037213 },
    bbMax: { x: 0.389632, y: 0.389632, z: 1.018021 },
    color: "#66716f",
    cost: 1,
    source: "x64i.rpf/v_bins.ytyp@24129523",
  }),
  prop({
    id: "plant-pot",
    label: "Большое растение",
    category: "Декор",
    archetype: "prop_plant_int_01a",
    archetypeHash: "0x1081fbdd",
    /*
     * Круглые ±1.8 среди шестизначных соседей выглядят опечаткой, но это
     * слово игры, а не наша описка: в `v_potted.ytyp` у архетипа 0x1081fbdd
     * записано ровно это. Сверено и по-другому — сфера архетипа
     * (`bsRadius` 2.726862) посчитана ИЗ ЭТОЙ коробки: половина диагонали
     * 3.6 x 3.6 x 1.955277 даёт те же 2.726862 до седьмого знака. То есть
     * запас в коробке у Rockstar намеренный, а не мусор.
     */
    bbMin: { x: -1.8, y: -1.8, z: 0 },
    bbMax: { x: 1.8, y: 1.8, z: 1.955277 },
    /*
     * А стоит растение вчетверо теснее, чем записано, и комнате важно именно
     * это: 3.6 метра — почти треть магазина 24/7 в ширину, и по коробке
     * архетипа растение отнимало полкомнаты, задевало защищённую зону у входа
     * с четырёх метров и не давало поставить рядом ничего.
     *
     * Замер: габарит `prop_plant_int_01a.yft` из
     * `x64i.rpf/levels/gta5/props/vegetation/v_potted.rpf/`, конвертированного
     * в GLB тем же нативным конвейером, что кормит предпросмотр. Считан по
     * min/max позиций всех четырёх мешей с учётом их места в дереве, оси
     * переведены из игровых в три-шные и обратно (game y = -gltf z). Точность
     * около полумиллиметра — столько стоит квантование позиций в GLB; на тех
     * четырёх предметах, где коробка архетипа честная, замер сходится с ней в
     * пределах той же половины миллиметра.
     *
     * По вертикали расхождения нет: 1.955078 замера против 1.955277 в
     * архетипе, поэтому высота и `floorOffset` остаются словом игры.
     */
    footprint: { width: 0.961914, depth: 0.998535 },
    color: "#4f9b68",
    cost: 3,
    source:
      "x64i.rpf/v_potted.ytyp@24129523 + v_potted.rpf/prop_plant_int_01a.yft@24129523",
  }),
]);

/*
 * Из чего сложено само помещение — файлами игры.
 *
 * Таблица опровергает утверждение, которое редактор держал за правду: «обычный
 * интерьер GTA одной моделью не лежит, это MLO — оболочка плюс сотни
 * расставленных сущностей, чьи архетипы резолвятся лишь частично». Первая
 * половина верна, вторая — нет. Архетипы САМОГО помещения резолвятся все:
 * Rockstar положила его отдельными drawable в `v_int_66.rpf` и `v_int_68.rpf`,
 * ровно как отделку Auto Shop, и с ОДНИМ словарём текстур на весь интерьер.
 * Не резолвятся чужие пропы вокруг — витрины, ящики, мусор, — но помещение это
 * и не они.
 *
 * Проверено на установленной игре, build 24129523: в `v_int_66.rpf` двадцать
 * drawable при одном `v_66_247_txd.ytd`, в `v_int_68.rpf` — двадцать четыре
 * при одном `v_68_gas_txd.ytd`. Общий словарь здесь не мелочь: партия моделей
 * читает его один раз на всю комнату, и вся она приезжает за 1.6 секунды
 * против 13.4 поштучно.
 *
 * Взяты не все. Reflection-прокси (`v_66_reflection`, `v_68_gassrefproxy`) —
 * коробка для отражений, в кадре она встала бы поверх стен; `*_shadowmap*` —
 * запечённые тени плоскостями; `*dirt`/`*stains` — грязь наложением поверх
 * пола, которой в кадре нечем разрешить спор глубины; задняя комната и туалет
 * — соседние помещения того же MLO, а правят не их.
 *
 *
 * ГДЕ ЧТО СТОИТ
 *
 * Координаты сняты из `v_int_66.ytyp` и `v_int_68.ytyp` командой
 * `inspect-interior-ytyp` нативного хоста: это позиция сущности MLO. Та же
 * система координат, в которой человек расставляет предметы, и та же, которую
 * компилятор кладёт в YMAP — `worldPosition = location.position + orientation *
 * item.position`. Отсюда следствие, ради которого таблица и заведена:
 * помещение и предметы едут в кадр ОДНИМ преобразованием, и поставленный у
 * полки холодильник встанет в игре у той же полки.
 *
 * Все повороты — единичные кватернионы (проверено по тем же файлам), поэтому
 * поворота здесь нет вовсе: место записано тремя числами, а не семью.
 *
 * Таблица лежит в контракте, а не в редакторе и не в настольном приложении,
 * потому что нужна обоим: настольное собирает по ней пути в архивах, окно —
 * места в кадре. Две копии разошлись бы на первой же правке, и разошлись бы
 * молча: стена встала бы там, где её нет.
 *
 * Ключ — `id` шаблона комнаты, а не имя интерьера: комнату в кадре выбирают
 * локацией проекта, локация ссылается на шаблон, и второй таблицы перевода
 * между ними заводить незачем.
 *
 * Подписи частей переведены с имён самой Rockstar — `v_66_shelves` это
 * стеллажи, `v_68_fridgedrinks` холодильник с напитками — и ничего сверх них
 * не утверждают. Нужны они редактору отделки: он группирует поверхности по
 * деталям, и без подписи человек выбирал бы «покрасить v_66_shop711».
 */
export const INTERIOR_ROOM_MODELS = freeze({
  "convenience-store-small": {
    interior: "v_int_66",
    textures: "v_66_247_txd.ytd",
    parts: [
      /* Оболочка: стены, пол, потолок и витрина. Одна на весь MLO, поэтому
         захватывает и заднюю комнату — так она устроена в игре. */
      {
        id: "v_66_shop711",
        label: "Зал: стены, пол и потолок",
        x: 1.88767,
        y: -0.004299164,
        z: 1.776144,
      },
      {
        id: "v_66_counter",
        label: "Прилавок",
        x: -2.7867064,
        y: -3.0527363,
        z: 1.525816,
      },
      {
        id: "v_66_fridge",
        label: "Холодильники",
        x: 5.1508894,
        y: 1.3355978,
        z: 1.120156,
      },
      {
        id: "v_66_shelves",
        label: "Стеллажи",
        x: 1.9542933,
        y: -5.1572437,
        z: 0.607475,
      },
      {
        id: "v_66_lamps",
        label: "Лампы",
        x: 1.8896961,
        y: -0.5734372,
        z: 1.775093,
      },
      {
        id: "v_66_duct",
        label: "Вентиляция",
        x: 1.88767,
        y: -0.004299164,
        z: 1.776144,
      },
      /* Постеров два, и это не дубль: `v_66_posters` привязан к limbo,
         `v_66_posters2` — к торговому залу, геометрия у них разная, и игра
         рисует оба. */
      {
        id: "v_66_posters",
        label: "Постеры подсобки",
        x: 1.8911772,
        y: -1.9198904,
        z: 1.776208,
      },
      {
        id: "v_66_posters2",
        label: "Постеры зала",
        x: 1.8911772,
        y: -1.9198914,
        z: 1.776208,
      },
    ],
  },
  "gas-station-store-small": {
    interior: "v_int_68",
    textures: "v_68_gas_txd.ytd",
    parts: [
      {
        id: "v_68_gasstationshell",
        label: "Зал: стены, пол и потолок",
        x: 2.121115,
        y: 1.134371,
        z: 1.776143,
      },
      {
        id: "v_68_counter",
        label: "Прилавок",
        x: 4.618532,
        y: -1.863029,
        z: 1.526534,
      },
      {
        id: "v_68_fridgedrinks",
        label: "Холодильник с напитками",
        x: -5.059744,
        y: -1.310567,
        z: 1.116227,
      },
      {
        id: "v_68_fridgefood",
        label: "Холодильник с едой",
        x: -1.267596,
        y: 2.450718,
        z: 1.116227,
      },
      {
        id: "v_68_glasschillers",
        label: "Стекло холодильника с напитками",
        x: -4.788642,
        y: -1.310777,
        z: 1.311849,
      },
      {
        id: "v_68_glasschillers2",
        label: "Стекло холодильника с едой",
        x: -1.267807,
        y: 2.179615,
        z: 1.311849,
      },
      {
        id: "v_68_mags",
        label: "Стойка журналов",
        x: 1.984233,
        y: -1.846063,
        z: 1.293176,
      },
      {
        id: "v_68_donuts",
        label: "Пончики",
        x: 2.210442,
        y: -1.821176,
        z: 0.937072,
      },
      {
        id: "v_68_donutshadow",
        label: "Тень под пончиками",
        x: 3.059134,
        y: -2.221323,
        z: 0.958275,
      },
      {
        id: "v_68_shopsigns",
        label: "Вывески",
        x: 0.973284,
        y: -0.860126,
        z: 3.054243,
      },
      {
        id: "v_68_broeknvend",
        label: "Сломанный автомат",
        x: 5.457391,
        y: 1.753532,
        z: 0.954903,
      },
      {
        id: "v_68_posters",
        label: "Постеры",
        x: 1.209661,
        y: -1.91989,
        z: 1.776208,
      },
      {
        id: "v_68_ducttape",
        label: "Вентиляция",
        x: 1.8503,
        y: 1.28879,
        z: 1.797035,
      },
    ],
  },
});

/** Модель помещения по идентификатору шаблона комнаты. */
export function getInteriorRoomModel(templateId) {
  const key = String(templateId || "");
  /* Собственное поле, а не унаследованное: идентификатор комнаты приходит из
     проекта, а `constructor` и `__proto__` есть у любого объекта. */
  return Object.hasOwn(INTERIOR_ROOM_MODELS, key)
    ? INTERIOR_ROOM_MODELS[key]
    : null;
}

export const INTERIOR_PRESETS = freeze([
  {
    id: "blank",
    label: "Пустой макет",
    description: "Начать с чистого помещения",
    entities: [],
  },
  {
    id: "balanced",
    label: "Удобная раскладка",
    description: "Два стеллажа и островная витрина с широкими проходами",
    entities: [
      ["vending-drink", -1.4, 0.4, 0],
      ["vending-drink-blue", 0, 0.4, 0],
      ["cooler-single", 1.35, 0.45, 0],
      ["trash-bin", 4.2, -4.2, 0],
    ],
  },
  {
    id: "quick-stop",
    label: "Быстрая покупка",
    description: "Напитки, кофе и снеки рядом с выходом",
    entities: [
      ["cooler-single", -1.3, 0.4, 0],
      ["vending-drink", 0, 0.35, 0],
      ["trash-bin", 4.2, -4.2, 0],
    ],
  },
]);

export function getInteriorTemplate(id, version = 1) {
  return (
    INTERIOR_TEMPLATES.find(
      (item) => item.id === id && item.version === version,
    ) || null
  );
}

export function getInteriorLocation(id) {
  return INTERIOR_LOCATIONS.find((item) => item.id === id) || null;
}

/* Предмет ищут на каждую сущность в каждой проверке макета — то есть сотни раз
   на одно движение мыши. Перебор пяти записей стоил бы недорого, но карта
   стоит ноль и не вырастет вместе с каталогом. */
const propsById = new Map(INTERIOR_PROPS.map((item) => [item.id, item]));

export function getInteriorProp(id) {
  return propsById.get(id) || null;
}

export function getInteriorPreset(id) {
  return INTERIOR_PRESETS.find((item) => item.id === id) || null;
}
