/*
 * Укрытия, которые подсвечивает мод прострелов, — опись от руки.
 *
 * Мод («prostrel_cpt.rpf» от panikamods) кладёт на каптах полупрозрачные
 * оболочки поверх укрытий, которые пробивает пуля: заборов, ворот, домов,
 * кондиционеров на крышах, мусорных баков, прицепов. Оболочка — отдельная
 * модель `progmat_N` в форме своего укрытия, с зашитой текстурой 4×4 одного
 * цвета: цвет и прозрачность подсветки задаёт она, а форму — сетка.
 *
 * Здесь — то, чего в файлах мода нет: как укрытие называть человеку, к
 * какому виду оно относится и чем его покрасить в кадре предпросмотра.
 * Имена даны по форме оболочки и месту на карте. Всё, что снимается с
 * файлов (сколько мест, в каких районах, границы), лежит рядом в
 * `placements.js` — его пишет `scripts/prepare-wallbang-resources.mjs`.
 *
 * `id` — навсегда: по нему правка человека живёт в «Моих работах», в кодах
 * и в имени модели в игре (`astral_wallbang_<id>.ydr`). Переименовать
 * подпись можно, `id` — нет.
 */

/* Виды укрытий: так их и ищут глазами на капте, и так удобно красить
   разными цветами — «дома синим, заборы зелёным». */
export const WALLBANG_KINDS = Object.freeze([
  Object.freeze({
    id: "buildings",
    label: "Дома и гаражи",
    description: "Стены целых построек: пуля проходит насквозь.",
  }),
  Object.freeze({
    id: "fences",
    label: "Заборы и стены",
    description: "Заборы, ворота, парапеты и отдельные стенки.",
  }),
  Object.freeze({
    id: "roofs",
    label: "На крышах",
    description: "Кондиционеры и короба, за которыми прячутся на крышах.",
  }),
  Object.freeze({
    id: "cover",
    label: "Баки и прицепы",
    description: "Мусорные баки и прицепы фур на земле.",
  }),
  Object.freeze({
    id: "power",
    label: "Трансформаторы",
    description: "Уличные трансформаторы подстанций.",
  }),
]);

/*
 * `source` — модель мода, `material` — цвет самого укрытия в кадре
 * предпросмотра (под подсветкой): бетон, штукатурка, металл. Это рисунок,
 * а не текстура Rockstar, — подпись кадра так и говорит.
 */
export const WALLBANG_OBJECTS = Object.freeze([
  Object.freeze({
    id: "fence",
    source: "progmat_1",
    label: "Забор",
    kind: "fences",
    description: "Длинный забор вдоль дворов, с тумбами у проезда.",
    material: "#8f8d88",
  }),
  Object.freeze({
    id: "long_fence",
    source: "progmat_2",
    label: "Длинный забор",
    kind: "fences",
    description: "Забор углом вдоль целого квартала.",
    material: "#8a8883",
  }),
  Object.freeze({
    id: "gate",
    source: "progmat_3",
    label: "Ворота",
    kind: "fences",
    description: "Двустворчатые ворота во двор дома.",
    material: "#6f6a64",
  }),
  Object.freeze({
    id: "wood_fence",
    source: "progmat_4",
    label: "Деревянный забор",
    kind: "fences",
    description: "Пролёт забора из досок между столбами.",
    material: "#7d6450",
  }),
  Object.freeze({
    id: "transformer",
    source: "progmat_5",
    label: "Трансформатор",
    kind: "power",
    description: "Трансформатор подстанции с изоляторами наверху.",
    material: "#6c776b",
  }),
  Object.freeze({
    id: "roof_aircon",
    source: "progmat_6",
    label: "Кондиционер на крыше",
    kind: "roofs",
    description: "Короб кондиционера с вентилятором сверху.",
    material: "#a9adb2",
  }),
  Object.freeze({
    id: "roof_box",
    source: "progmat_7",
    label: "Короб на крыше",
    kind: "roofs",
    description: "Вентиляционный короб со скошенным торцом.",
    material: "#a3a7ac",
  }),
  Object.freeze({
    id: "big_aircon",
    source: "progmat_8",
    label: "Большой кондиционер",
    kind: "roofs",
    description: "Промышленный блок с вентилятором и трубами.",
    material: "#b0b4b8",
  }),
  Object.freeze({
    id: "trailer",
    source: "progmat_9",
    label: "Прицеп фуры",
    kind: "cover",
    description: "Полуприцеп грузовика на стоянке.",
    material: "#c8cbcf",
  }),
  Object.freeze({
    id: "parapet",
    source: "progmat_10",
    label: "Бетонный парапет",
    kind: "fences",
    description: "Низкая стенка углом у стоянки.",
    material: "#94928c",
  }),
  Object.freeze({
    id: "garages",
    source: "progmat_11",
    label: "Гаражи",
    kind: "buildings",
    description: "Три гаража и длинный сарай за домами.",
    material: "#b7a88f",
  }),
  Object.freeze({
    id: "house_garage",
    source: "progmat_12",
    label: "Дом с гаражом",
    kind: "buildings",
    description: "Одноэтажный дом и гараж рядом с ним.",
    material: "#bcab92",
  }),
  Object.freeze({
    id: "house",
    source: "progmat_13",
    label: "Двухэтажный дом",
    kind: "buildings",
    description: "Жилой дом целиком — все стены и крыша.",
    material: "#c1ae93",
  }),
  Object.freeze({
    id: "corner_wall",
    source: "progmat_14",
    label: "Угловая стена",
    kind: "fences",
    description: "Две стены, сходящиеся углом.",
    material: "#8c8a85",
  }),
  Object.freeze({
    id: "fence_panels",
    source: "progmat_15",
    label: "Щиты забора",
    kind: "fences",
    description: "Три отдельных щита ограждения.",
    material: "#7f7c77",
  }),
  Object.freeze({
    id: "dumpster",
    source: "progmat_16",
    label: "Мусорный бак",
    kind: "cover",
    description: "Большой мусорный контейнер с крышкой.",
    material: "#3b5a45",
  }),
]);

/* Коды районов игры (popzone.ipl) — как их зовёт русская версия GTA V. */
export const WALLBANG_ZONE_NAMES = Object.freeze({
  MIRR: "Миррор-Парк",
  LMESA: "Ла-Меса",
  SANDY: "Сэнди-Шорс",
  PALETO: "Палето-Бэй",
  STRAW: "Строберри",
  RANCHO: "Ранчо",
  ROCKF: "Рокфорд-Хиллз",
  DAVIS: "Дэвис",
  CYPRE: "Сайпрес-Флэтс",
});

/* Имя модели оболочки в игре: своё пространство имён, а не `progmat_N`. */
export const wallbangAssetName = (id) => `astral_wallbang_${id}`;

/* Типы, расстановка и контейнер набора в слое Astral. */
export const WALLBANG_TYPES_NAME = "astral_wallbang";
export const WALLBANG_MAP_NAME = "astral_wallbang_map";
export const WALLBANG_CONTAINER = "x64/astral/astral_wallbang.rpf";
