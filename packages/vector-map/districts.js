// Районы штата: таблица зон игры, их контуры в мировых координатах и два инструмента контура.
import CELLS_BY_ZONE from "./zone-cells.json" with { type: "json" };
import OUTLINE_BY_ID from "./zone-outlines.json" with { type: "json" };

const ZONE_POINT_CAP = 96;
const STAIR_REACH = 100;
const STAIR_CUT = 0.25;
const STAIR_PASSES = 2;
const WALK_CAP = 100000;

// Колонки строки таблицы и порядок полей района
const TABLE_COLUMNS = ["id", "zoneCode", "nameEn", "name", "group"];
const DISTRICT_ORDER = ["id", "zoneCode", "group", "wild", "name", "nameEn", "cells", "points", "center"];
const CELL_KEYS = ["minX", "minY", "maxX", "maxY"];
const XY = ["x", "y"];

// id, код зоны в игре, имя по-английски, имя по-русски, группа
const TABLE_ROWS = [
  ["airport", "AirP", "Los Santos International Airport", "Аэропорт Лос-Сантоса", "city"],
  ["alta", "Alta", "Alta", "Альта", "city"],
  ["banning", "Banning", "Banning", "Бэннинг", "city"],
  ["vespucci", "Beach", "Vespucci Beach", "Веспуччи-Бич", "city"],
  ["burton", "Burton", "Burton", "Бёртон", "city"],
  ["chamberlain", "ChamH", "Chamberlain Hills", "Чемберлен-Хиллз", "city"],
  ["vinewood-hills", "CHIL", "Vinewood Hills", "Вайнвуд-Хиллз", "city"],
  ["cypress-flats", "Cypre", "Cypress Flats", "Сайпресс-Флэтс", "city"],
  ["davis", "Davis", "Davis", "Дэвис", "city"],
  ["del-perro-beach", "DeLBe", "Del Perro Beach", "Дель-Перро-Бич", "city"],
  ["del-perro", "DelPe", "Del Perro", "Дель-Перро", "city"],
  ["del-sol", "DelSol", "La Puerta", "Дель-Соль", "city"],
  ["downtown", "Downt", "Downtown", "Даунтаун", "city"],
  ["downtown-vinewood", "DTVine", "Downtown Vinewood", "Даунтаун-Вайнвуд", "city"],
  ["east-vinewood", "East_V", "East Vinewood", "Восточный Вайнвуд", "city"],
  ["el-burro", "EBuro", "El Burro Heights", "Эль-Бурро-Хайтс", "city"],
  ["elysian", "Elysian", "Elysian Island", "Остров Элизиан", "city"],
  ["golf", "Golf", "GWC and Golfing Society", "Гольф-клуб", "city"],
  ["hawick", "Hawick", "Hawick", "Хавик", "city"],
  ["racetrack", "Hors", "Vinewood Racetrack", "Ипподром Вайнвуд", "city"],
  ["little-seoul", "Koreat", "Little Seoul", "Литл-Сеул", "city"],
  ["legion-square", "LegSqu", "Legion Square", "Легион-сквер", "city"],
  ["la-mesa", "LMesa", "La Mesa", "Ла-Меса", "city"],
  ["la-puerta", "LosPuer", "La Puerta", "Ла-Пуэрта", "city"],
  ["mirror-park", "Mirr", "Mirror Park", "Миррор-Парк", "city"],
  ["morningwood", "Morn", "Morningwood", "Морнингвуд", "city"],
  ["movie-studio", "Movie", "Richards Majestic", "Киностудия", "city"],
  ["murrieta", "Murri", "Murrieta Heights", "Мурриета-Хайтс", "city"],
  ["observatory", "Observ", "Galileo Observatory", "Обсерватория", "city"],
  ["pacific-bluffs", "PBluff", "Pacific Bluffs", "Пасифик-Блаффс", "city"],
  ["pillbox", "PBOX", "Pillbox Hill", "Пиллбокс-Хилл", "city"],
  ["rancho", "RANCHO", "Rancho", "Ранчо", "city"],
  ["richman-glen", "RGLEN", "Richman Glen", "Ричман-Глен", "city"],
  ["richman", "Richm", "Richman", "Ричман", "city"],
  ["rockford", "Rockf", "Rockford Hills", "Рокфорд-Хиллз", "city"],
  ["mission-row", "SKID", "Mission Row", "Мишн-Роу", "city"],
  ["arena", "Stad", "Maze Bank Arena", "Арена Мэйз-Банк", "city"],
  ["strawberry", "STRAW", "Strawberry", "Строберри", "city"],
  ["terminal", "Termina", "Terminal", "Терминал", "city"],
  ["textile-city", "TEXTI", "Textile City", "Текстиль-Сити", "city"],
  ["vespucci-canals", "VCana", "Vespucci Canals", "Каналы Веспуччи", "city"],
  ["vespucci-central", "Vesp", "Vespucci", "Веспуччи", "city"],
  ["vinewood", "Vine", "Vinewood", "Вайнвуд", "city"],
  ["west-vinewood", "WVine", "West Vinewood", "Западный Вайнвуд", "city"],
  ["port", "ZP_ORT", "Port of South Los Santos", "Порт Лос-Сантоса", "city"],
  ["alamo-sea", "Alamo", "Alamo Sea", "Озеро Аламо", "county"],
  ["fort-zancudo", "ArmyB", "Fort Zancudo", "Форт-Занкудо", "county"],
  ["baytree", "Baytre", "Baytree Canyon", "Бэйтри-Каньон", "county"],
  ["banham", "BhamCa", "Banham Canyon", "Бэнхэм-Каньон", "county"],
  ["braddock-pass", "BradP", "Braddock Pass", "Брэддок-Пасс", "county"],
  ["raton-canyon", "CANNY", "Raton Canyon", "Каньон Ратон", "county"],
  ["cassidy-creek", "CCreak", "Cassidy Creek", "Ручей Кэссиди", "county"],
  ["chumash", "CHU", "Chumash", "Чумаш", "county"],
  ["chiliad-wilderness", "CMSW", "Chiliad Mountain State Wilderness", "Заповедник Чилиад", "county"],
  ["senora-desert", "Desrt", "Grand Senora Desert", "Пустыня Сенора", "county"],
  ["el-gordo", "ELGorL", "El Gordo Lighthouse", "Маяк Эль-Гордо", "county"],
  ["galilee", "Galfish", "Galilee", "Галилея", "county"],
  ["galileo-park", "Galli", "Galileo Park", "Парк Галилео", "county"],
  ["grapeseed", "GrapeS", "Grapeseed", "Грейпсид", "county"],
  ["chaparral", "Greatc", "Great Chaparral", "Грейт-Чапаррель", "county"],
  ["harmony", "Harmo", "Harmony", "Хармони", "county"],
  ["humane-labs", "HumLab", "Humane Labs and Research", "Хумейн-Лабс", "county"],
  ["prison", "Jail", "Bolingbroke Penitentiary", "Тюрьма Болингброук", "county"],
  ["land-act-reservoir", "LAct", "Land Act Reservoir", "Водохранилище Лэнд-Акт", "county"],
  ["lago-zancudo", "LAGO", "Lago Zancudo", "Лаго-Занкудо", "county"],
  ["land-act-dam", "LDam", "Land Act Dam", "Дамба Лэнд-Акт", "county"],
  ["mount-chiliad", "MTChil", "Mount Chiliad", "Гора Чилиад", "county"],
  ["mount-gordo", "MTGordo", "Mount Gordo", "Гора Гордо", "county"],
  ["mount-josiah", "MTJose", "Mount Josiah", "Гора Джосайя", "county"],
  ["north-chumash", "NCHU", "North Chumash", "Северный Чумаш", "county"],
  ["noose", "Noose", "N.O.O.S.E", "Штаб NOOSE", "county"],
  ["paleto-cove", "PalCov", "Paleto Cove", "Бухта Палето", "county"],
  ["paleto-bay", "Paleto", "Paleto Bay", "Палето-Бэй", "county"],
  ["paleto-forest", "PalFor", "Paleto Forest", "Лес Палето", "county"],
  ["palomino", "PalHigh", "Palomino Highlands", "Паломино-Хайлендс", "county"],
  ["power-station", "Palmpow", "Palmer-Taylor Power Station", "Электростанция", "county"],
  ["procopio", "ProcoB", "Procopio Beach", "Пляж Прокопио", "county"],
  ["redwood-track", "RTRAK", "Redwood Lights Track", "Трек Редвуд", "county"],
  ["san-chianski", "SanChia", "San Chianski Mountain Range", "Хребет Сан-Чански", "county"],
  ["sandy-shores", "Sandy", "Sandy Shores", "Сэнди-Шорс", "county"],
  ["stab-city", "Slab", "Stab City", "Стэб-Сити", "county"],
  ["tataviam", "Tatamo", "Tataviam Mountains", "Горы Татавиам", "county"],
  ["tongva-hills", "TongvaH", "Tongva Hills", "Тонгва-Хиллз", "county"],
  ["tongva-valley", "TongvaV", "Tongva Valley", "Тонгва-Вэлли", "county"],
  ["wind-farm", "WindF", "Ron Alternates Wind Farm", "Ветряная ферма", "county"],
  ["zancudo-river", "Zancudo", "Zancudo River", "Река Занкудо", "county"],
  ["davis-quartz", "zQ_UAR", "Davis Quartz", "Карьер Дэвис-Кварц", "county"],
];

// Зоны вне города: в каталоге приходят выключенными
const WILD_IDS = new Set([
  "alamo-sea",
  "baytree",
  "braddock-pass",
  "raton-canyon",
  "cassidy-creek",
  "chiliad-wilderness",
  "senora-desert",
  "galileo-park",
  "chaparral",
  "lago-zancudo",
  "land-act-reservoir",
  "land-act-dam",
  "mount-chiliad",
  "mount-gordo",
  "mount-josiah",
  "paleto-forest",
  "paleto-cove",
  "palomino",
  "procopio",
  "san-chianski",
  "tataviam",
  "tongva-hills",
  "tongva-valley",
  "zancudo-river",
  "redwood-track",
  "el-gordo",
]);

export const DISTRICT_TABLE = Object.freeze(TABLE_ROWS.map((row) => Object.freeze(row.slice())));

// --- помощники на парах и списках ---

const ascending = (a, b) => a - b;
const uniqueAscending = (values) => Array.from(new Set(values)).sort(ascending);
const keyOf = ([x, y]) => `${x}:${y}`;
const toXY = ([x, y]) => ({ x, y });
const pickFrozen = (source, keys) => Object.freeze(Object.fromEntries(keys.map((key) => [key, source[key]])));

// Предыдущий и следующий по кругу
const around = (list, i) => [list.at(i - 1), list[(i + 1) % list.length]];

// Вектор от точки к точке и косое произведение двух векторов
const delta = (from, to) => [to.x - from.x, to.y - from.y];
const cross = ([ux, uy], [vx, vy]) => ux * vy - vx * uy;

// Точка на одной прямой с обоими соседями по какой-нибудь оси
const straightOn = (a, b, c) => [0, 1].some((axis) => a[axis] === b[axis] && b[axis] === c[axis]);

// --- контур объединения прямоугольников ---

// Стороны клетки: где сосед (столбец, строка) и между какими углами (0 — левый/нижний, 1 — правый/верхний)
// идёт ребро; внутренность остаётся слева.
const CELL_SIDES = [
  { toward: [0, -1], from: [0, 0], to: [1, 0] },
  { toward: [1, 0], from: [1, 0], to: [1, 1] },
  { toward: [0, 1], from: [1, 1], to: [0, 1] },
  { toward: [-1, 0], from: [0, 1], to: [0, 0] },
];

const cellKey = (col, row) => `${col},${row}`;

// Номера клеток между двумя линиями сетки; линия, которой нет в сетке (NaN), считается нулевой слева.
const indicesBetween = (lines, lo, hi) => {
  const first = Math.max(lines.indexOf(lo), 0);
  return Array.from({ length: Math.max(lines.indexOf(hi) - first, 0) }, (_, k) => first + k);
};

// Первое по порядку ребро, выходящее из точки; пустой список ключ не держит.
const pull = (outgoing, key) => {
  const [edge, ...rest] = outgoing.get(key) ?? [];
  if (rest.length) outgoing.set(key, rest);
  else outgoing.delete(key);
  return edge ?? null;
};

// Начальные точки рёбер одного обхода, пока он не вернётся в исходную точку.
function* walk(outgoing, startKey) {
  let steps = 0;
  let edge = pull(outgoing, startKey);
  while (edge) {
    yield edge.start;
    const tipKey = keyOf(edge.end);
    edge = tipKey === startKey || steps >= WALK_CAP ? null : pull(outgoing, tipKey);
    steps += 1;
  }
}

// Замкнутые обходы; каждый начинается с самой ранней из оставшихся точек.
function* ringsOf(outgoing) {
  while (outgoing.size) {
    const [startKey] = outgoing.keys();
    const ring = Array.from(walk(outgoing, startKey));
    if (ring.length >= 4) yield ring;
  }
}

const perimeter = (ring) =>
  ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = around(ring, i)[1];
    return sum + Math.abs(nx - x) + Math.abs(ny - y);
  }, 0);

// Точки на прямой (и развороты назад) выбрасываются, остальные округляются.
const dropStraight = (ring) =>
  ring
    .filter((point, i) => {
      const [prev, next] = around(ring, i);
      return !straightOn(prev, point, next);
    })
    .map((point) => toXY(point.map(Math.round)));

export function rectangleOutline(rectangles) {
  if (!rectangles.length) return [];
  const [xs, ys] = [["minX", "maxX"], ["minY", "maxY"]].map(([lo, hi]) =>
    uniqueAscending(rectangles.flatMap((rect) => [rect[lo], rect[hi]])));
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  if (cols < 1 || rows < 1) return [];

  const covered = new Set(
    rectangles.flatMap((rect) => {
      const colIds = indicesBetween(xs, rect.minX, rect.maxX);
      return indicesBetween(ys, rect.minY, rect.maxY).flatMap((row) => colIds.map((col) => cellKey(col, row)));
    }),
  );

  const corner = (col, row, [dx, dy]) => [xs[col + dx], ys[row + dy]];
  const edges = Array.from({ length: cols * rows }, (_, i) => [i % cols, Math.floor(i / cols)])
    .filter(([col, row]) => covered.has(cellKey(col, row)))
    .flatMap(([col, row]) =>
      CELL_SIDES.filter(({ toward: [dc, dr] }) => !covered.has(cellKey(col + dc, row + dr))).map(({ from, to }) => ({
        start: corner(col, row, from),
        end: corner(col, row, to),
      })));
  const outgoing = edges.reduce((byStart, edge) => {
    const key = keyOf(edge.start);
    return byStart.set(key, [...(byStart.get(key) ?? []), edge]);
  }, new Map());

  const [longest] = Array.from(ringsOf(outgoing), (ring) => [perimeter(ring), ring]).sort(([a], [b]) => b - a);
  return longest ? dropStraight(longest[1]) : [];
}

// --- прореживание ---

// Удвоенная площадь треугольника (предыдущая, вершина, следующая): чем меньше, тем «площе» вершина.
const flatness = (points, i) => {
  const [prev, next] = around(points, i);
  return Math.abs(cross(delta(prev, points[i]), delta(prev, next)));
};

const flattestIndex = (points) =>
  points.reduce(
    (best, _, i) => {
      const area = flatness(points, i);
      return area < best.area ? { area, index: i } : best;
    },
    { area: Infinity, index: 0 },
  ).index;

export function limitPoints(points, limit) {
  const rest = [...points];
  while (rest.length > limit) rest.splice(flattestIndex(rest), 1);
  return rest;
}

// --- контур района ---

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Точка на четверть пути от p к q, по осям
const cutToward = (p, q) =>
  XY.reduce((cut, axis) => ({ ...cut, [axis]: Math.round(p[axis] + (q[axis] - p[axis]) * STAIR_CUT) }), {});

// Вершина лестницы (оба соседа не дальше порога) заменяется двумя срезанными точками.
const meltPass = (points) =>
  points.flatMap((p, i) => {
    const [prev, next] = around(points, i);
    const onStair = dist(p, prev) <= STAIR_REACH && dist(p, next) <= STAIR_REACH;
    return onStair ? [cutToward(p, prev), cutToward(p, next)] : [p];
  });

const meltStairs = (points) => Array.from({ length: STAIR_PASSES }).reduce((current) => meltPass(current), points);

// Пары из плоского списка [x0, y0, x1, y1, …]; лишнее число в конце отбрасывается
const pairsOf = (flat) => Array.from({ length: flat.length >> 1 }, (_, i) => flat.slice(2 * i, 2 * i + 2));

function zonePoints(id, cells) {
  const flat = OUTLINE_BY_ID[id];
  const raw = flat ? pairsOf(flat).map(toXY) : limitPoints(meltStairs(rectangleOutline(cells)), ZONE_POINT_CAP);
  return Object.freeze(raw.map((point) => pickFrozen(point, XY)));
}

// Середина охватывающей рамки ячеек по одной оси
const middleOf = (cells, [lo, hi]) => {
  const [low, high] = [Math.min, Math.max].map((pick) => pick(...cells.flatMap((cell) => [cell[lo], cell[hi]])));
  return Math.round((low + high) / 2);
};

function makeDistrict(row) {
  const fields = Object.fromEntries(TABLE_COLUMNS.map((column, at) => [column, row[at]]));
  const cells = Object.freeze((CELLS_BY_ZONE[fields.zoneCode] || []).map((cell) => pickFrozen(cell, CELL_KEYS)));
  return pickFrozen(
    {
      ...fields,
      wild: WILD_IDS.has(fields.id),
      cells,
      points: zonePoints(fields.id, cells),
      center: Object.freeze({ x: middleOf(cells, ["minX", "maxX"]), y: middleOf(cells, ["minY", "maxY"]) }),
    },
    DISTRICT_ORDER,
  );
}

export const WORLD_DISTRICTS = Object.freeze(Array.from(DISTRICT_TABLE, (row) => makeDistrict(row)));

export const WORLD_DISTRICT_MAP = Object.freeze(
  WORLD_DISTRICTS.reduce((byId, district) => Object.assign(byId, { [district.id]: district }), {}),
);
