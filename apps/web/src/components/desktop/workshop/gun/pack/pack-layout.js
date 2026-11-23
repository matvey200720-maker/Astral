/*
 * Раскладка стволов на экране «Ганпак» — чистая геометрия, без сцены (владелец, 02.11.2026).
 *
 * Правило со слов владельца: один ствол — по центру; второй — первый уезжает влево, второй встаёт справа; третий появляется сверху по центру; четвёртый — верхний
 * уезжает в левый столбик, новый встаёт в правый. Дальше так же: ряды растут вверх по два, неполный верхний ряд стоит по центру. Шесть стволов — ещё два столбика; когда их больше,
 * столбиков становится столько, сколько даёт самый крупный кадр: восемь рядов по два были бы мелкой полоской посередине экрана.
 *
 * Масштаб один на всех, как на обложках паков: длинный ствол длиннее короткого, как в игре. Размеры — метры, начало координат — середина всей раскладки.
 */

/** До скольких стволов столбиков всегда два: так раскладку описал владелец. */
export const TWO_COLUMNS_UP_TO = 6;
const MOST_COLUMNS = 7;
/** Щели между стволами — доля самого длинного ствола: стволы не касаются ни при каком повороте кадра. */
const GAP_X = 0.14;
const GAP_Y = 0.2;
/** Ряд не ниже этой доли самого длинного ствола: пистолеты не слипаются рядами, а расстояние между рядами не скачет от модели к модели. */
const LEAST_ROW = 0.3;

/* Сколько стволов в каждом ряду снизу вверх: снизу полные, верхний — что осталось. */
function rowsOf(count, columns) {
  const rows = [];
  for (let left = count; left > 0; left -= columns) rows.push(Math.min(left, columns));
  return rows;
}

function measure(sizes, columns) {
  const longest = Math.max(...sizes.map((size) => size.width), 1e-3);
  const gapX = longest * GAP_X;
  const gapY = longest * GAP_Y;
  const least = longest * LEAST_ROW;
  const rows = [];
  let at = 0;
  for (const members of rowsOf(sizes.length, columns)) {
    const row = sizes.slice(at, at + members);
    rows.push({ from: at, members, height: Math.max(least, ...row.map((size) => size.height)) });
    at += members;
  }
  const cell = longest + gapX;
  const width = cell * Math.max(...rows.map((row) => row.members)) - gapX;
  const height = rows.reduce((sum, row) => sum + row.height, 0) + gapY * (rows.length - 1);
  return { rows, cell, gapY, width, height };
}

/**
 * Столбиков для `sizes` на кадре с отношением сторон `aspect`: до `TWO_COLUMNS_UP_TO` стволов два (один ствол — один), дальше — самый крупный кадр.
 */
export function columnsFor(sizes, aspect = 16 / 9) {
  const count = sizes.length;
  if (count <= 1) return 1;
  if (count <= TWO_COLUMNS_UP_TO) return 2;
  let best = 2;
  let bestSpan = Infinity;
  for (let columns = 2; columns <= Math.min(MOST_COLUMNS, count); columns += 1) {
    const { width, height } = measure(sizes, columns);
    /* Какая высота кадра нужна раскладке: чем меньше, тем стволы крупнее. */
    const span = Math.max(height, width / aspect);
    if (span < bestSpan - 1e-6) {
      best = columns;
      bestSpan = span;
    }
  }
  return best;
}

/**
 * Куда встаёт каждый ствол. `sizes` — `[{ width, height }]` в порядке списка; `aspect` — отношение сторон кадра. Возвращает `{ placed: [{ x, y }], width, height, columns }`:
 * `placed` — середины стволов в порядке `sizes`, `width` и `height` — габарит всей раскладки.
 */
export function layoutPack(sizes, { aspect = 16 / 9 } = {}) {
  if (!sizes.length) return { placed: [], width: 0, height: 0, columns: 0 };
  const columns = columnsFor(sizes, aspect);
  const { rows, cell, gapY, width, height } = measure(sizes, columns);
  const placed = new Array(sizes.length);
  let y = -height / 2;
  for (const row of rows) {
    const middle = y + row.height / 2;
    const start = -((row.members - 1) * cell) / 2;
    for (let index = 0; index < row.members; index += 1) placed[row.from + index] = { x: start + index * cell, y: middle };
    y += row.height + gapY;
  }
  return { placed, width, height, columns };
}

/* Пока модель едет, место под ствол считается по его семейству: когда она приедет, поправка выйдет маленькой. */
const FAMILY_SIZES = Object.freeze({
  pistol: { width: 0.24, height: 0.16 },
  smg: { width: 0.5, height: 0.2 },
  rifle: { width: 0.9, height: 0.24 },
  shotgun: { width: 0.95, height: 0.2 },
  sniper: { width: 1.2, height: 0.26 },
  machinegun: { width: 1.15, height: 0.3 },
  launcher: { width: 1.25, height: 0.32 },
  melee: { width: 0.7, height: 0.14 },
  thrown: { width: 0.2, height: 0.14 },
});

export const familySize = (family) => FAMILY_SIZES[family] || FAMILY_SIZES.rifle;
