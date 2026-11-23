/*
 * Раскладка макета в координатах зала — общий язык двух половин редактора.
 *
 * Половины было две, и они не разговаривали. Слева человек правил числа
 * (`InteriorEditor.jsx` вместе с `@modovik/interior-contract`), справа стоял
 * зал из игры (`interior-scene.js`), и объекты макета в кадр не попадали
 * вовсе — их ставила не мышь, а список заранее заданных точек. Здесь лежит
 * перевод между этими двумя мирами, и только он: ни three, ни React. Оттого
 * его можно проверить числами, а не картинкой.
 *
 * Из контракта берётся ровно одна чистая функция — `rotatedFootprint`. След
 * повёрнутого предмета нужен и проверке макета, и удержанию предмета в комнате,
 * и считать его здесь второй формулой значило бы завести вторую правду: мышь
 * ставила бы туда, куда отчёт потом красит ошибкой.
 *
 *
 * ДВЕ СИСТЕМЫ КООРДИНАТ
 *
 * У макета оси GTA: X на восток, Y на север, Z вверх, метры. У кадра оси
 * three: X на восток, Y ВВЕРХ, Z на юг. Отсюда перестановка и знак:
 *
 *     world.x = x - centre.x
 *     world.z = centre.y - y
 *     world.y = z (высота объекта над полом)
 *
 * Поворот при этом не меняет знака: поворот на θ вокруг игрового +Z — это
 * поворот на те же θ вокруг три-шного +Y. Проверено на векторе (1,0): в макете
 * он уходит в (0,1), в кадре — из (X=1,Z=0) в (X=0,Z=-1), что и есть поворот на
 * +90° вокруг Y.
 *
 *
 * ПОЧЕМУ СЕРЕДИНА КОМНАТЫ — ЭТО НАЧАЛО КАДРА
 *
 * Комнаты в реестре несимметричны: у магазина 24/7 X идёт от -2.48 до 9.02, а
 * не от -5.75 до 5.75. Раскладка, привязанная к началу координат макета,
 * вставала бы в кадр углом, поэтому середина комнаты кладётся в ноль кадра —
 * и по этому же переводу в кадр встают части самого помещения из игры
 * (`interior-models.js`). Одно преобразование на обе половины — иначе стены
 * приехали бы отдельно от того, что между ними ставят.
 *
 * Смещение считается по шаблону, а не по первому объекту: пустой макет — это
 * обычное состояние нового проекта, а комната у него уже есть.
 */

import { rotatedFootprint } from "@modovik/interior-contract";

/** Ноль на случай, когда шаблона комнаты нет: стенд поднимает сцену без него. */
const ORIGIN = Object.freeze({ x: 0, y: 0 });

/**
 * Пустая раскладка.
 *
 * Сцену зовут не только из редактора: стенд окна (`dev/preview-lab`) и витрина
 * мода поднимают её без единого объекта и без шаблона комнаты. Пустая
 * раскладка — их штатное состояние, а не поломка.
 */
export const EMPTY_LAYOUT = Object.freeze({
  room: null,
  /* Какую комнату правят: `id` шаблона из реестра. По нему сцена спрашивает
     игру про настоящее помещение, и без него оно осталось бы схемой даже там,
     где игра его отдаёт. Числа комнаты одни этот вопрос не решают: два шаблона
     разного размера — это два разных магазина, а не один в двух видах. */
  roomId: "",
  zones: Object.freeze([]),
  props: Object.freeze([]),
  entities: Object.freeze([]),
  selectedId: null,
  /* Шаги привязки — из настроек проекта. Значения по умолчанию те же, что у
     `createInteriorDesign`: без них мышь ставила бы объект в произвольную
     дробь метра, а числовое поле рядом — в четверть. */
  snap: 0.25,
  rotationSnap: 45,
});

const number = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

/**
 * План пола по шаблону комнаты: середина, размеры и сам прямоугольник.
 *
 * `null` — честный ответ: без шаблона сцена рисует зал и ничего больше.
 */
export function createFloorPlan(room) {
  if (!room) return null;
  const minX = number(room.minX);
  const maxX = number(room.maxX);
  const minY = number(room.minY);
  const maxY = number(room.maxY);
  return {
    centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: Math.abs(maxX - minX),
    depth: Math.abs(maxY - minY),
    height: Math.abs(number(room.maxZ) - number(room.minZ)),
    minX,
    maxX,
    minY,
    maxY,
  };
}

/** Точка макета → точка пола зала: `[x, z]` в осях three. */
export function worldPoint(plan, x, y) {
  const centre = plan?.centre || ORIGIN;
  return [number(x) - centre.x, centre.y - number(y)];
}

/** Точка пола зала → точка макета. Обратная к `worldPoint`, до знака. */
export function designPoint(plan, worldX, worldZ) {
  const centre = plan?.centre || ORIGIN;
  return { x: number(worldX) + centre.x, y: centre.y - number(worldZ) };
}

/**
 * Привязка к сетке макета.
 *
 * Шаг приходит из настроек проекта (`design.settings.snap`), а не назначается
 * здесь: привязка — свойство макета, и она же участвует в проверке границ.
 * Ноль и отрицательный шаг означают «без привязки» — иначе деление на ноль
 * тихо превращает координату в NaN, а нормализация проекта роняет редактор
 * на первой же протяжке мышью.
 */
export function snapTo(value, step) {
  const size = number(step);
  const point = number(value);
  if (!(size > 0)) return point;
  return Math.round(point / size) * size;
}

/*
 * Числовые пределы координаты объекта — те же, что в нормализации проекта
 * (`design.js`, `finite(..., -100, 100)`). Мышь может ткнуть куда угодно, в том
 * числе за дальнюю стену сорокаметрового зала; координата, вышедшая за предел,
 * роняет `normalizeInteriorDesign` исключением, а не помечается ошибкой в
 * отчёте. Поэтому обрезаем здесь: за зону выйти можно и нужно (это видимая
 * ошибка макета), за пределы формата — нет.
 */
const COORDINATE_LIMIT = 100;

export function clampCoordinate(value) {
  return Math.min(Math.max(number(value), -COORDINATE_LIMIT), COORDINATE_LIMIT);
}

/**
 * Где может стоять СЕРЕДИНА предмета: комната минус половина его следа.
 *
 * Комната — прямоугольник, предмет — тоже, и в комнате должен помещаться весь
 * предмет, а не его середина. Иначе холодильник, прижатый к стене, наполовину
 * стоит в ней: мышь его туда пускает, а отчёт красит ошибкой — ровно то
 * расхождение, из-за которого человек не понимает, где предмет «можно»
 * ставить.
 *
 * `null` — честный ответ там, где шаблона комнаты нет вовсе (стенд окна,
 * витрина мода): удерживать не в чем.
 */
export function roomLimits(plan, footprint) {
  if (!plan) return null;
  const halfWidth = Math.max(number(footprint?.width), 0) / 2;
  const halfDepth = Math.max(number(footprint?.depth), 0) / 2;
  const minX = plan.minX + halfWidth;
  const maxX = plan.maxX - halfWidth;
  const minY = plan.minY + halfDepth;
  const maxY = plan.maxY - halfDepth;
  /* Предмет шире комнаты: держать его негде, и середина — единственное место,
     где он хотя бы стоит симметрично. В каталоге такого нет, но чужой проект
     может принести, а перевёрнутые границы дали бы NaN. */
  const fitsX = minX <= maxX;
  const fitsY = minY <= maxY;
  return {
    minX: fitsX ? minX : plan.centre.x,
    maxX: fitsX ? maxX : plan.centre.x,
    minY: fitsY ? minY : plan.centre.y,
    maxY: fitsY ? maxY : plan.centre.y,
  };
}

/*
 * Порядок действий: сетка, потом стена.
 *
 * Наоборот выходит хуже: прижатый к стене предмет сетка сдвинула бы обратно
 * наружу, и он не смог бы встать вплотную. Позиция у стены при этом не лежит на
 * сетке — и это правильно: сетка нужна, чтобы предметы стояли рядами, а стена
 * сильнее любого ряда.
 */
const settle = (value, snap, min, max) => {
  const onGrid = snapTo(value, snap);
  const held =
    min === undefined ? onGrid : Math.min(Math.max(onGrid, min), max);
  return clampCoordinate(held);
};

/**
 * Прижать к комнате предмет, который уже стоит.
 *
 * У поворота и у числовых полей луча нет: они меняют предмет на месте. А
 * поворот меняет и его след — предмет, стоящий вплотную к стене, при повороте
 * на 45° уходит в неё углом. Поэтому та же арифметика вызывается и без
 * указателя, только без привязки к сетке: сетка — про то, куда ведёт рука, а
 * не про то, что делать с уже поставленным.
 */
export function holdInRoom(plan, placement) {
  const size = {
    width: number(placement?.width),
    depth: number(placement?.depth),
  };
  const limits =
    plan && (size.width || size.depth)
      ? roomLimits(plan, rotatedFootprint(size, number(placement?.yaw)))
      : null;
  return {
    x: settle(number(placement?.x), 0, limits?.minX, limits?.maxX),
    y: settle(number(placement?.y), 0, limits?.minY, limits?.maxY),
  };
}

/**
 * Точка под указателем — в координаты макета, с привязкой, захватом и стенами.
 *
 * Одно место на три случая: постановка нового объекта, протяжка старого и
 * приманка под курсором. Разойдись они по трём вызовам, приманка показывала бы
 * не ту точку, в которую объект потом встанет, — а это ровно та ложь, ради
 * которой всё и затевалось.
 *
 * `placement` описывает, что именно ставят: размер предмета, его поворот и
 * смещение точки захвата от середины. Без него возвращается голая точка пола —
 * такой ответ нужен ровно один раз, в начале протяжки, чтобы измерить захват.
 *
 * Луч бьётся в бесконечную плоскость пола, а при пологом взгляде полоса кадра
 * у горизонта показывает сотни метров: без удержания один пиксель мыши
 * выбрасывал предмет на десятки метров за комнату. Теперь предмет доходит до
 * стены и едет вдоль неё.
 */
export function pickPoint(plan, worldX, worldZ, snap, placement = null) {
  const point = designPoint(plan, worldX, worldZ);
  const centreX = point.x - number(placement?.grabX);
  const centreY = point.y - number(placement?.grabY);
  if (!placement?.width && !placement?.depth)
    return {
      x: settle(centreX, snap),
      y: settle(centreY, snap),
    };
  const limits = roomLimits(
    plan,
    rotatedFootprint(
      { width: number(placement.width), depth: number(placement.depth) },
      number(placement.yaw),
    ),
  );
  return {
    x: settle(centreX, snap, limits?.minX, limits?.maxX),
    y: settle(centreY, snap, limits?.minY, limits?.maxY),
  };
}

const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * Привести раскладку к форме, на которую можно положиться.
 *
 * Раскладку собирает редактор из проекта, и по дороге в неё легко попасть
 * `undefined` — удалённый объект, неизвестный тип, пустой отчёт проверки. Сцена
 * при этом строит по ней буферы инстансов, и одна дырка в данных означает NaN в
 * матрице и исчезнувший из кадра зал целиком.
 */
export function normalizeLayout(input) {
  if (!input) return EMPTY_LAYOUT;
  const props = new Map();
  for (const prop of asArray(input.props)) {
    if (!prop?.id) continue;
    props.set(prop.id, {
      id: String(prop.id),
      label: String(prop.label || prop.id),
      colour: String(prop.colour || prop.color || "#8a8f98"),
      width: Math.max(0.05, number(prop.width, 0.5)),
      depth: Math.max(0.05, number(prop.depth, 0.5)),
      height: Math.max(0.05, number(prop.height, 0.5)),
      /* Имя архетипа в игре: по нему сцена пробует достать настоящую модель.
         Нет имени — сразу заглушка, без обращения к игре. */
      archetype: prop.archetype ? String(prop.archetype) : "",
      /* Насколько начало координат модели ниже её низа. Нужно только настоящей
         модели: коробку-заглушку сцена ставит низом на пол сама. */
      floorOffset: number(prop.floorOffset, 0),
    });
  }

  const entities = [];
  for (const entity of asArray(input.entities)) {
    if (!entity?.id || !props.has(entity.propId)) continue;
    entities.push({
      id: String(entity.id),
      propId: String(entity.propId),
      x: number(entity.x),
      y: number(entity.y),
      z: number(entity.z),
      yaw: number(entity.yaw),
      hidden: Boolean(entity.hidden),
      locked: Boolean(entity.locked),
      /* Что про объект сказала проверка: `error` — вне зоны или на защищённом
         месте, `warn` — налез на соседа. Красит объект сцена, а считает
         `validateInteriorDesign`; своей геометрической проверки здесь нет
         намеренно, иначе две правды разойдутся на первой же правке реестра. */
      level: ["error", "warn"].includes(entity.level) ? entity.level : "ok",
    });
  }

  return {
    room: input.room || null,
    roomId: input.roomId ? String(input.roomId) : "",
    zones: asArray(input.zones)
      .filter((zone) => zone && zone.id)
      .map((zone) => ({
        id: String(zone.id),
        label: String(zone.label || zone.id),
        minX: number(zone.minX),
        maxX: number(zone.maxX),
        minY: number(zone.minY),
        maxY: number(zone.maxY),
      })),
    props: [...props.values()],
    entities,
    selectedId: input.selectedId ? String(input.selectedId) : null,
    snap: number(input.snap, EMPTY_LAYOUT.snap),
    rotationSnap: number(input.rotationSnap, EMPTY_LAYOUT.rotationSnap),
  };
}

/** Состав раскладки: по нему видно, надо ли пересобирать буферы инстансов. */
export function layoutShape(layout) {
  return layout.entities
    .filter((entity) => !entity.hidden)
    .map((entity) => `${entity.propId}:${entity.id}`)
    .join("|");
}
