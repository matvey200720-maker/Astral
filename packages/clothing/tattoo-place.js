/*
 * Место тату под рисунок (ТЗ 06.10.2026, вечер, задача 3): «рисунок
 * остаётся там, где нарисован, даже если заменяешь тату другой зоны».
 *
 * Мастерская красит тело в плоскостях зон тату (`tattoo-zones.js`), а в
 * игру рисунок едет картинками тату игры, отмеченных в «Замене». Раньше
 * картинка тату бралась только из его рамки: нарисованное вне рамок
 * отмеченных тату в игру не попадало. Теперь:
 *  1. нарисованное делится на пятна — связные области чернил своей зоны
 *     (штрихи ближе ~5 % зоны — одно пятно; U по кругу части тела
 *     замкнута, пятно может лежать через шов);
 *  2. тату, в рамке которого пятно лежит целиком, остаётся на своём месте;
 *  3. остальные отмеченные тату переезжают под самые крупные из оставшихся
 *     пятен — рамка по пятну с запасом, без поворота. Пятен больше, чем
 *     тату, — пятна одной зоны сливаются (сначала те, что дают меньше
 *     пустоты), пока их не станет столько же: нарисованное не теряется;
 *  4. каждое тату несёт только свои пятна (`regionMask`): соседнее пятно,
 *     попавшее в рамку, не рисуется в игре дважды.
 *
 * Чистый JS: план в окне («Замена») и сборка пакета в главном процессе
 * считают одно и то же.
 */

import { TATTOO_ZONES, zoneIndex } from "./tattoo-zones.js";

/* Сетка пятен — клеток по длинной стороне картинки зоны: окно считает план
   по уменьшенной картинке, главный процесс — по полной, а сетка одна. */
export const PLACE_GRID = 128;
/* Чернила — альфа выше этого: мягкий край кисти ещё рисунок. */
const INK = 8;
/* Штрихи ближе стольких клеток — одно пятно (буквы надписи, точки узора). */
const GAP = 3;
/* Прозрачный запас вокруг пятна у переехавшего тату — в клетках. */
const PAD = 2;

const round = (value) => Math.round(value * 1e6) / 1e6;
const zoneOf = (value) => (typeof value === "number" ? value : zoneIndex(value));

/* Самая короткая дуга столбцов, покрывающая занятые: `[начало, длина]`. */
function circularSpan(used, columns) {
  let count = 0;
  for (let column = 0; column < columns; column += 1) count += used[column];
  if (count === columns) return [0, columns];
  let best = 0;
  let bestStart = 0;
  let run = 0;
  let runStart = 0;
  for (let step = 0; step < 2 * columns; step += 1) {
    if (used[step % columns]) {
      run = 0;
      continue;
    }
    if (!run) runStart = step;
    run += 1;
    if (run > best && run < columns) {
      best = run;
      bestStart = runStart;
    }
  }
  return [(bestStart + best) % columns, columns - best];
}

/**
 * Пятна чернил по зонам. `images` — `[{ zone, width, height, data }]`
 * (номер зоны или её имя, RGBA). Ответ: `{ regions, grids }` — пятна от
 * крупных к мелким (`{ id, ids, zone, u0, u1, v0, v1, pad, ink }`: рамка
 * чернил в долях зоны, `u0` в `[0, 1)`, `u1` может выходить за 1 — пятно
 * через шов; `pad` — запас клеток в долях) и сетки меток зон для
 * `regionMask`.
 */
export function inkRegions(images) {
  const regions = [];
  const grids = new Map();
  let nextId = 1;
  for (const image of images || []) {
    const zone = zoneOf(image?.zone);
    const { width, height, data } = image || {};
    if (zone < 0 || zone >= TATTOO_ZONES.length || !(width > 0) || !(height > 0) || !data) continue;
    const cell = Math.max(1, Math.ceil(Math.max(width, height) / PLACE_GRID));
    const columns = Math.ceil(width / cell);
    const rows = Math.ceil(height / cell);
    const size = columns * rows;
    const ink = new Uint32Array(size);
    for (let y = 0; y < height; y += 1) {
      const row = Math.floor(y / cell) * columns;
      const line = y * width * 4 + 3;
      for (let x = 0; x < width; x += 1)
        if (data[line + x * 4] > INK) ink[row + Math.floor(x / cell)] += 1;
    }
    /* Чернила с запасом GAP клеток (по кругу U) — так близкие штрихи
       сходятся в одно пятно. */
    const wide = new Uint8Array(size);
    for (let row = 0; row < rows; row += 1)
      for (let column = 0; column < columns; column += 1) {
        if (!ink[row * columns + column]) continue;
        for (let step = -GAP; step <= GAP; step += 1)
          wide[row * columns + (((column + step) % columns) + columns) % columns] = 1;
      }
    const near = new Uint8Array(size);
    for (let row = 0; row < rows; row += 1)
      for (let column = 0; column < columns; column += 1) {
        if (!wide[row * columns + column]) continue;
        for (let step = Math.max(0, row - GAP); step <= Math.min(rows - 1, row + GAP); step += 1)
          near[step * columns + column] = 1;
      }
    const labels = new Int32Array(size);
    const stack = [];
    for (let start = 0; start < size; start += 1) {
      if (!near[start] || labels[start]) continue;
      const id = nextId;
      nextId += 1;
      labels[start] = id;
      stack.push(start);
      while (stack.length) {
        const at = stack.pop();
        const row = Math.floor(at / columns);
        const column = at - row * columns;
        for (let dy = -1; dy <= 1; dy += 1) {
          const next = row + dy;
          if (next < 0 || next >= rows) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const index = next * columns + ((((column + dx) % columns) + columns) % columns);
            if (near[index] && !labels[index]) {
              labels[index] = id;
              stack.push(index);
            }
          }
        }
      }
    }
    const found = new Map();
    for (let index = 0; index < size; index += 1) {
      if (!ink[index]) continue;
      const id = labels[index];
      let region = found.get(id);
      if (!region) {
        region = { used: new Uint8Array(columns), r0: rows, r1: -1, ink: 0 };
        found.set(id, region);
      }
      const row = Math.floor(index / columns);
      region.used[index - row * columns] = 1;
      region.r0 = Math.min(region.r0, row);
      region.r1 = Math.max(region.r1, row);
      region.ink += ink[index];
    }
    const edge = (column) =>
      column < columns
        ? Math.min(width, column * cell)
        : width + Math.min(width, (column - columns) * cell);
    for (const [id, region] of found) {
      const [start, length] = circularSpan(region.used, columns);
      const full = length >= columns;
      regions.push({
        id,
        ids: [id],
        zone,
        u0: full ? 0 : edge(start) / width,
        u1: full ? 1 : edge(start + length) / width,
        v0: (region.r0 * cell) / height,
        v1: Math.min(height, (region.r1 + 1) * cell) / height,
        pad: { u: (PAD * cell) / width, v: (PAD * cell) / height },
        ink: region.ink,
      });
    }
    grids.set(zone, { columns, rows, cell, width, height, labels });
  }
  regions.sort((left, right) => right.ink - left.ink || left.id - right.id);
  return { regions, grids };
}

/**
 * Выборка только своих пятен: `(zone, u, v) → bool`. `grids` — из
 * `inkRegions`, `regions` — пятна этого тату.
 */
export function regionMask(grids, regions) {
  const allowed = new Map();
  for (const region of regions || []) {
    if (!allowed.has(region.zone)) allowed.set(region.zone, new Set());
    for (const id of region.ids || [region.id]) allowed.get(region.zone).add(id);
  }
  return (zone, u, v) => {
    const grid = grids?.get(zone);
    const ids = allowed.get(zone);
    if (!grid || !ids || !(v >= 0) || v > 1) return false;
    const x = (u - Math.floor(u)) * grid.width;
    const column = Math.min(grid.columns - 1, Math.floor(x / grid.cell));
    const row = Math.min(grid.rows - 1, Math.floor((v * grid.height) / grid.cell));
    return ids.has(grid.labels[row * grid.columns + column]);
  };
}

/**
 * Лежит ли пятно целиком в рамке тату (`{ zone, uv, scale, rotation }` из
 * коллекции игры): та же зона, все углы рамки чернил — внутри повёрнутой
 * рамки тату. U замкнута: пятно сдвигается на целый оборот к центру рамки.
 */
export function regionInFrame(region, decoration) {
  if (zoneOf(decoration?.zone) !== region.zone) return false;
  const x = Number(decoration.uv?.x ?? 0.5);
  const y = 1 - Number(decoration.uv?.y ?? 0.5);
  const halfWidth = Math.abs(Number(decoration.scale?.x ?? 0.5));
  const halfHeight = Math.abs(Number(decoration.scale?.y ?? 0.5));
  const angle = (-Number(decoration.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const shift = Math.round(x - (region.u0 + region.u1) / 2);
  const corners = [
    [region.u0, region.v0],
    [region.u1, region.v0],
    [region.u0, region.v1],
    [region.u1, region.v1],
  ];
  return corners.every(([u, v]) => {
    const du = u + shift - x;
    const dv = v - y;
    const along = du * cos + dv * sin;
    const across = -du * sin + dv * cos;
    return Math.abs(along) <= halfWidth + 1e-9 && Math.abs(across) <= halfHeight + 1e-9;
  });
}

/**
 * Какая доля чернил лежит за рамкой тату — для честных слов окна установки: `0` — рисунок целиком в рамке, `0.4` — 40 % за рамкой. `image` — `{ width, height, data }` зоны,
 * `decoration` — рамка из коллекции игры. U замкнута: точка берётся на том обороте, что ближе к центру рамки. Чернил нет — `0`.
 */
export function inkOutsideFrame(image, decoration) {
  const { width, height, data } = image || {};
  if (!(width > 0) || !(height > 0) || !data) return 0;
  const x = Number(decoration?.uv?.x ?? 0.5);
  const y = 1 - Number(decoration?.uv?.y ?? 0.5);
  const halfWidth = Math.abs(Number(decoration?.scale?.x ?? 0.5));
  const halfHeight = Math.abs(Number(decoration?.scale?.y ?? 0.5));
  const angle = (-Number(decoration?.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let total = 0;
  let outside = 0;
  for (let row = 0; row < height; row += 1) {
    const dv = (row + 0.5) / height - y;
    for (let column = 0; column < width; column += 1) {
      if (data[(row * width + column) * 4 + 3] <= INK) continue;
      total += 1;
      const u = (column + 0.5) / width;
      const du = u + Math.round(x - u) - x;
      const along = du * cos + dv * sin;
      const across = -du * sin + dv * cos;
      if (Math.abs(along) > halfWidth || Math.abs(across) > halfHeight) outside += 1;
    }
  }
  return total ? outside / total : 0;
}

/**
 * Место тату под пятно: рамка чернил с запасом, без поворота, в осях
 * коллекции игры (`uvPos.y` снизу вверх, `scale` — половина рамки).
 * Числа — до шести знаков: так их пишет коллекция, и так же печётся
 * картинка.
 */
export function decorationForRegion(region) {
  const centreU = (region.u0 + region.u1) / 2;
  const centreV = (region.v0 + region.v1) / 2;
  const width = Math.min(1, region.u1 - region.u0 + 2 * (region.pad?.u || 0));
  const height = region.v1 - region.v0 + 2 * (region.pad?.v || 0);
  return {
    zone: TATTOO_ZONES[region.zone].id,
    uv: { x: round(centreU - Math.floor(centreU)), y: round(1 - centreV) },
    scale: { x: round(width / 2), y: round(height / 2) },
    rotation: 0,
  };
}

/* Два пятна одной зоны — одно: самая короткая общая дуга по U. */
function mergeRegions(left, right) {
  let best = null;
  for (const turn of [-1, 0, 1]) {
    const u0 = Math.min(left.u0, right.u0 + turn);
    const u1 = Math.max(left.u1, right.u1 + turn);
    if (!best || u1 - u0 < best.u1 - best.u0) best = { u0, u1 };
  }
  let { u0, u1 } = best;
  if (u1 - u0 >= 1) {
    u0 = 0;
    u1 = 1;
  } else if (u0 < 0 || u0 >= 1) {
    const turn = Math.floor(u0);
    u0 -= turn;
    u1 -= turn;
  }
  return {
    id: Math.min(left.id, right.id),
    ids: [...left.ids, ...right.ids],
    zone: left.zone,
    u0,
    u1,
    v0: Math.min(left.v0, right.v0),
    v1: Math.max(left.v1, right.v1),
    pad: left.pad,
    ink: left.ink + right.ink,
  };
}

const area = (region) => (region.u1 - region.u0) * (region.v1 - region.v0);

/**
 * План переноса. `targets` — отмеченные тату игры по порядку
 * (`{ key, zone, uv, scale, rotation }`), `regions` — `inkRegions().regions`.
 * Ответ: `{ places, left }` — у каждого тату `{ key, action, regions,
 * decoration? }` (`keep` — на своём месте, `move` — под пятно, `skip` —
 * пятна не хватило) и пятна, которым не хватило тату.
 */
export function planTattooPlaces({ targets, regions }) {
  const list = targets || [];
  const pool = (regions || []).map((region) => ({ ...region, ids: region.ids || [region.id] }));
  while (pool.length > list.length) {
    let best = null;
    for (let left = 0; left < pool.length; left += 1)
      for (let right = left + 1; right < pool.length; right += 1) {
        if (pool[left].zone !== pool[right].zone) continue;
        const merged = mergeRegions(pool[left], pool[right]);
        const waste = area(merged) - area(pool[left]) - area(pool[right]);
        if (!best || waste < best.waste) best = { left, right, merged, waste };
      }
    if (!best) break;
    pool.splice(best.right, 1);
    pool.splice(best.left, 1, best.merged);
  }
  pool.sort((left, right) => right.ink - left.ink || left.id - right.id);
  const places = list.map((target) => ({ key: target.key, action: "skip", regions: [] }));
  const used = new Set();
  list.forEach((target, index) => {
    const inside = pool.filter((region) => !used.has(region) && regionInFrame(region, target));
    if (!inside.length) return;
    for (const region of inside) used.add(region);
    places[index] = { key: target.key, action: "keep", regions: inside };
  });
  list.forEach((target, index) => {
    /* `movable: false` — коллекцию этого тату перенос не правит. */
    if (places[index].action !== "skip" || target.movable === false) return;
    const region = pool.find((item) => !used.has(item));
    if (!region) return;
    used.add(region);
    places[index] = {
      key: target.key,
      action: "move",
      regions: [region],
      decoration: decorationForRegion(region),
    };
  });
  return { places, left: pool.filter((region) => !used.has(region)) };
}
