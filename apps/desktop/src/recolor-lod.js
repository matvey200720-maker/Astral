/*
 * Дальняя прорисовка набора — общая система LOD мастерской.
 *
 * Модели карты игра показывает вблизи (HD), а дальше — своими «родителями»:
 * LOD (до 500 м), SLOD1 (до 1 км), SLOD2 (до 2,5 км), SLOD3 (до 15 км). У
 * родителей свои текстуры: у LOD — листы словаря места (`cs4_13_lod.ytd`), у
 * SLOD — атласы, где одно место занимает угол большого листа (`cs4_13_slod2`
 * в словаре моделей SLOD2), у SLOD3 — атлас целого района. Перекраска одних
 * HD издалека не видна: место «прыгает» в штатный облик.
 *
 * Здесь облик доезжает до каждого уровня цепочки (её находит подготовка
 * набора по картам игры — `scripts/lib/lod-chain.mjs`, опись `lod`):
 *
 *   1. Поле облика: точки поверхностей HD-моделей места в мировых
 *      координатах, у каждой — номер облика (какой операцией красить).
 *   2. Каждая дальняя модель встаёт на своё место в мире, её треугольники
 *      растеризуются в развёртку своих листов; у каждого текселя — точка
 *      мира. Тексель ближе порога к поверхности места получает облик
 *      ближайшей точки поля, дальше — «чужой» (соседи по атласу, пустыня).
 *   3. Тексель, на который смотрит и своё место, и чужое (повторяющийся лист
 *      или лист, общий с соседним местом), не красится: иначе перекрасилась
 *      бы вся карта. Чужих пользователей листа знают модели тех же файлов
 *      (без места — значит, чужие) и маски подготовки (`lod.shared`) — где
 *      этот лист берут модели других файлов.
 *   4. Облик — операцией: тон по светотени листа (цвет работы), серый (как в
 *      моде), отделка по стенам (узор и картинка ангара — той же проекцией,
 *      что HD), «как в игре» — не трогать.
 *
 * Файлы игры правятся на месте: длина текстур та же (`texturePayload`), файл
 * едет в контейнер набора под своим именем и перекрывает штатный.
 */

import zlib from "node:zlib";
import { decodeTextureRef, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import { placementTransform } from "@modovik/climb-contract/recolor/placement";
import { PLATE_CLEARANCE_DEPTH, PLATE_CLEARANCE_MARGIN, plateClearance } from "@modovik/climb-contract/recolor/decal";
import { boxProjection, sampleImage, sampleTile } from "@modovik/climb-contract/recolor/finish";
import { tintTable } from "./recolor-pixels.js";
import { patchResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";
import { deflateRaw, inflateResource } from "@modovik/native-rs";

const inflateRaw = inflateResource;

/* Y-вверх rage-drawable → Z-вверх игры. */
const toGame = (x, y, z) => [x, -z, y];

/*
 * Порог «своей» поверхности по уровню: `xy` — по плану, `z` — по высоте.
 * LOD (1) повторяет форму HD — порог одинаков во все стороны. SLOD (SLOD1 2,
 * SLOD2 3, SLOD3 4, SLOD4 6) — грубые коробки и атласы, натянутые сверху на
 * рельеф: крыша там лежит у земли, на несколько метров ниже настоящей. Свою
 * поверхность у них ищут по плану, тесно (земля в 12 м от крыши — уже не
 * крыша: пятна облика вокруг домов), а по высоте — с большим допуском.
 */
export const LOD_REACH = Object.freeze({
  1: Object.freeze({ xy: 3.5, z: 3.5 }),
  2: Object.freeze({ xy: 4, z: 25 }),
  3: Object.freeze({ xy: 5, z: 30 }),
  4: Object.freeze({ xy: 8, z: 40 }),
  6: Object.freeze({ xy: 12, z: 50 }),
});
const reachOf = (level) => LOD_REACH[level] || LOD_REACH[3];

/* ------------------------------------------------------------------ *
 * Поле облика
 * ------------------------------------------------------------------ */

/*
 * Сторона поверхности: тексель дальней модели берёт облик только у точки,
 * чья грань смотрит туда же (угол меньше 60°, `FACING`). Иначе земля в паре
 * метров от стены получила бы облик стены (издалека здание окружала бы
 * полоса его цвета), наружная стена — облик внутренней в 30 см за ней, а
 * верх крыши — облик потолка под ней.
 */
const FACING = 0.5;
/* Клетка следа в плане (м) — см. `createLookField`. */
const FOOTPRINT = 0.5;
/* Насколько ниже своей поверхности точка уже не видна снаружи (м). */
const HIDDEN_DEPTH = 2;
const unit = (normal) => {
  if (!normal) return null;
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  return length > 0 ? [normal[0] / length, normal[1] / length, normal[2] / length] : null;
};

/**
 * Точки поверхностей места с номерами облика и ориентацией. `spacing` —
 * шаг точек по треугольнику (м). Поиск ближайшей — по сетке с клеткой
 * порога: на запрос уходит 27 клеток, а не сотни.
 */
export function createLookField({ spacing = 2 } = {}) {
  const STRIDE = 7;
  let data = new Float32Array(4096 * STRIDE);
  /*
   * Цвет ближней поверхности в точке (фикс 1 ТЗ 06.10.2026): у точки —
   * средний цвет листа HD вокруг неё после правки и до неё (по 3 числа).
   * Дальний тексель берёт его через облик `transfer` — градиент, радуга,
   * перелив и картинка вдали те же, что вблизи, а не один средний цвет.
   * У точки без цвета — `NaN`.
   */
  let colours = null;
  let count = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grids = new Map();
  const keyOf = (ix, iy, iz) => ((ix + 8192) * 16384 + (iy + 8192)) * 16384 + (iz + 8192);
  /*
   * След в плане того, что смотрит вверх (крыша, земля, верх парапета), —
   * клетками `FOOTPRINT` м, с номерами обликов. Тексель дальней модели, что
   * смотрит вверх, берёт облик такой грани только над её следом. Без этого
   * земля вокруг здания на расстоянии порога (у SLOD — 4–12 м) брала цвет
   * крыши каймой, а вокруг мелочи на парковке — пятнами: вблизи их нет,
   * издалека здание стояло в зелёном ореоле (05.10.2026).
   */
  const footprint = new Map();
  /* Верх следа по клетке (м): под ним — нутро здания, снаружи не видно. */
  const footTop = new Map();
  const footKey = (ix, iy) => (ix + 1048576) * 2097152 + (iy + 1048576);
  function markFootprint(a, b, c, look) {
    const x0 = Math.floor(Math.min(a[0], b[0], c[0]) / FOOTPRINT);
    const x1 = Math.floor(Math.max(a[0], b[0], c[0]) / FOOTPRINT);
    const y0 = Math.floor(Math.min(a[1], b[1], c[1]) / FOOTPRINT);
    const y1 = Math.floor(Math.max(a[1], b[1], c[1]) / FOOTPRINT);
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const top = Math.max(a[2], b[2], c[2]);
    const mark = (ix, iy) => {
      const key = footKey(ix, iy);
      const looks = footprint.get(key);
      if (!looks) footprint.set(key, [look]);
      else if (!looks.includes(look)) looks.push(look);
      if (!(footTop.get(key) >= top)) footTop.set(key, top);
    };
    /* Мелкая грань — хотя бы клетка её середины. */
    mark(Math.floor((a[0] + b[0] + c[0]) / 3 / FOOTPRINT), Math.floor((a[1] + b[1] + c[1]) / 3 / FOOTPRINT));
    if (!area) return;
    for (let ix = x0; ix <= x1; ix += 1)
      for (let iy = y0; iy <= y1; iy += 1) {
        const px = (ix + 0.5) * FOOTPRINT;
        const py = (iy + 0.5) * FOOTPRINT;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) mark(ix, iy);
      }
  }
  /*
   * Точка под своей поверхностью, что смотрит вверх (земля под зданием,
   * нутро под крышей), ниже её больше чем на `HIDDEN_DEPTH`: снаружи её не
   * видно. Дальняя модель часто кладёт такую землю на тот же кусок листа,
   * что и крышу (развёртка сверху), — и общий тексель не должен считаться
   * чужим из-за земли, которую закрывает само здание (You Tool, LOD).
   */
  function hidden(x, y, z) {
    const top = footTop.get(footKey(Math.floor(x / FOOTPRINT), Math.floor(y / FOOTPRINT)));
    return top !== undefined && top > z + HIDDEN_DEPTH;
  }

  /* Облики следа рядом с точкой плана — в пределах `margin` метров. */
  function footprintLooks(x, y, margin) {
    const cx = Math.floor(x / FOOTPRINT);
    const cy = Math.floor(y / FOOTPRINT);
    const span = Math.max(0, Math.round(margin / FOOTPRINT));
    const looks = [];
    for (let ix = cx - span; ix <= cx + span; ix += 1)
      for (let iy = cy - span; iy <= cy + span; iy += 1)
        for (const look of footprint.get(footKey(ix, iy)) || []) if (!looks.includes(look)) looks.push(look);
    return looks;
  }

  function addPoint(x, y, z, look, normal = null, colour = null) {
    if ((count + 1) * STRIDE > data.length) {
      const grown = new Float32Array(data.length * 2);
      grown.set(data);
      data = grown;
    }
    if (colour || colours) {
      if (!colours) colours = new Float32Array((data.length / STRIDE) * 6).fill(Number.NaN);
      if (colours.length < (data.length / STRIDE) * 6) {
        const grown = new Float32Array((data.length / STRIDE) * 6).fill(Number.NaN);
        grown.set(colours);
        colours = grown;
      }
      if (colour) colours.set(colour.subarray ? colour.subarray(0, 6) : colour.slice(0, 6), count * 6);
    }
    data[count * STRIDE] = x;
    data[count * STRIDE + 1] = y;
    data[count * STRIDE + 2] = z;
    data[count * STRIDE + 3] = look;
    /* Нормаль 0 — сторона не известна: точка подходит любому текселю. */
    data[count * STRIDE + 4] = normal ? normal[0] : 0;
    data[count * STRIDE + 5] = normal ? normal[1] : 0;
    data[count * STRIDE + 6] = normal ? normal[2] : 0;
    count += 1;
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
    grids.clear();
  }

  /*
   * Треугольник — сеткой точек по барицентрам: стена 30 × 20 м — сотни точек.
   * `colour` — `{ uv: [[u, v] × 3], sample(u, v) → [6] | null }`: цвет листа
   * HD в точке (после правки и до неё) — для облика `transfer`.
   */
  function addTriangle(a, b, c, look, colour = null) {
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
    const steps = Math.max(1, Math.min(60, Math.ceil(Math.max(ab, ac, bc) / spacing)));
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = unit([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
    if (normal && normal[2] >= FACING) markFootprint(a, b, c, look);
    for (let i = 0; i <= steps; i += 1)
      for (let j = 0; j <= steps - i; j += 1) {
        const u = i / steps;
        const v = j / steps;
        const w = 1 - u - v;
        const sampled = colour
          ? colour.sample(colour.uv[0][0] * w + colour.uv[1][0] * u + colour.uv[2][0] * v, colour.uv[0][1] * w + colour.uv[1][1] * u + colour.uv[2][1] * v)
          : null;
        addPoint(a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, a[2] * w + b[2] * u + c[2] * v, look, normal, sampled);
      }
  }

  /**
   * Модель на месте сущности: `lookOf(mesh)` → номер облика или `null`
   * (поверхность в поле не идёт — стекло, наклейка); `colourOf(mesh)` →
   * `sample(u, v)` цвета листа HD (облик `transfer`) или `null`.
   */
  function addDrawable(drawable, placement, lookOf, colourOf = null) {
    const place = placementTransform(placement);
    for (const mesh of drawable.meshes || []) {
      const look = lookOf(mesh);
      if (look == null || look < 0) continue;
      const sample = mesh.uvs && colourOf ? colourOf(mesh) : null;
      const points = [];
      for (let at = 0; at < mesh.positions.length; at += 3)
        points.push(place(toGame(mesh.positions[at], mesh.positions[at + 1], mesh.positions[at + 2])));
      for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
        const ids = [mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]];
        addTriangle(
          points[ids[0]],
          points[ids[1]],
          points[ids[2]],
          look,
          sample ? { sample, uv: ids.map((id) => [mesh.uvs[id * 2], mesh.uvs[id * 2 + 1]]) } : null,
        );
      }
    }
  }

  /*
   * Сетка поиска с клеткой порога (`xy` по плану, `z` по высоте). Подробная
   * модель даёт точку на каждую вершину мелких граней — сотни тысяч точек
   * кучками, а порогу хватает одной точки на облик и сторону грани в клетке
   * в четверть порога (не мельче полушага): запрос перебирает десятки
   * точек, а не тысячи.
   */
  function gridFor(reach) {
    const id = `${reach.xy}/${reach.z}`;
    let grid = grids.get(id);
    if (grid) return grid;
    grid = new Map();
    const sub = Math.max(reach.xy / 4, spacing / 2);
    const subZ = Math.max(reach.z / 4, spacing / 2);
    const seen = new Set();
    for (let index = 0; index < count; index += 1) {
      const at = index * STRIDE;
      const thin = `${Math.floor(data[at] / sub)},${Math.floor(data[at + 1] / sub)},${Math.floor(data[at + 2] / subZ)},${data[at + 3]},${Math.round(data[at + 4] * 2)},${Math.round(data[at + 5] * 2)},${Math.round(data[at + 6] * 2)}`;
      if (seen.has(thin)) continue;
      seen.add(thin);
      const key = keyOf(Math.floor(data[at] / reach.xy), Math.floor(data[at + 1] / reach.xy), Math.floor(data[at + 2] / reach.z));
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(index);
    }
    grids.set(id, grid);
    return grid;
  }

  /**
   * Облик ближайшей точки в пределах порога `reach` (`{ xy, z }` или число —
   * одинаково во все стороны) или −1; `normal` (единичная) — только точки,
   * чья грань смотрит туда же (`FACING`), без неё — любые; `skip` — облики,
   * которых здесь не брать (нутро для уровней SLOD). Расстояние — по плану,
   * высота — в долях своего допуска.
   */
  function nearest(x, y, z, reachInput, normal = null, skip = null) {
    const index = nearestIndex(x, y, z, reachInput, normal, skip);
    return index < 0 ? -1 : data[index * STRIDE + 3];
  }

  /* То же, что `nearest`, — номер самой точки (−1 — своей поверхности нет). */
  function nearestIndex(x, y, z, reachInput, normal = null, skip = null) {
    const reach = typeof reachInput === "number" ? { xy: reachInput, z: reachInput } : reachInput;
    if (x < min[0] - reach.xy || y < min[1] - reach.xy || z < min[2] - reach.z) return -1;
    if (x > max[0] + reach.xy || y > max[1] + reach.xy || z > max[2] + reach.z) return -1;
    const grid = gridFor(reach);
    const cx = Math.floor(x / reach.xy);
    const cy = Math.floor(y / reach.xy);
    const cz = Math.floor(z / reach.z);
    const zScale = reach.xy / reach.z;
    let best = reach.xy * reach.xy;
    let found = -1;
    /* Тексель смотрит вверх — облик грани, что смотрит вверх, только над её
       следом (с запасом в четверть порога, не больше 2 м: у SLOD очертание
       крыши грубее, чем у HD). */
    const upward = normal && normal[2] >= FACING ? footprintLooks(x, y, Math.min(2, reach.xy / 4)) : null;
    for (let ix = cx - 1; ix <= cx + 1; ix += 1)
      for (let iy = cy - 1; iy <= cy + 1; iy += 1)
        for (let iz = cz - 1; iz <= cz + 1; iz += 1) {
          const list = grid.get(keyOf(ix, iy, iz));
          if (!list) continue;
          for (const index of list) {
            const at = index * STRIDE;
            if (skip && skip.has(data[at + 3])) continue;
            if (normal) {
              const nx = data[at + 4];
              const ny = data[at + 5];
              const nz = data[at + 6];
              if ((nx || ny || nz) && nx * normal[0] + ny * normal[1] + nz * normal[2] < FACING) continue;
              if (upward && nz >= FACING && !upward.includes(data[at + 3])) continue;
            }
            const dx = data[at] - x;
            const dy = data[at + 1] - y;
            const dz = (data[at + 2] - z) * zScale;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < best) {
              best = d;
              found = index;
            }
          }
        }
    return found;
  }

  /*
   * Цвет листа HD в точке: `[после правки × 3, до правки × 3]` или `null`.
   * Лист читается мелкой ступенью mip (`createSurfaceSampler`): цвет точки —
   * уже среднее листа вокруг неё, без ряби мелкого рисунка.
   */
  function colourAt(index) {
    if (!colours || index < 0) return null;
    const at = index * 6;
    if (Number.isNaN(colours[at])) return null;
    return colours.subarray(at, at + 6);
  }

  /** Лежит ли рамка (мин/макс мира) ближе `reach` к полю. */
  function touches(boxMin, boxMax, reachInput) {
    const reach = typeof reachInput === "number" ? { xy: reachInput, z: reachInput } : reachInput;
    return !(
      boxMax[0] < min[0] - reach.xy ||
      boxMax[1] < min[1] - reach.xy ||
      boxMax[2] < min[2] - reach.z ||
      boxMin[0] > max[0] + reach.xy ||
      boxMin[1] > max[1] + reach.xy ||
      boxMin[2] > max[2] + reach.z
    );
  }

  return {
    addPoint,
    addTriangle,
    addDrawable,
    nearest,
    nearestIndex,
    lookOf: (index) => (index < 0 ? -1 : data[index * STRIDE + 3]),
    colourAt,
    hidden,
    touches,
    get count() {
      return count;
    },
    /* Есть ли у поля цвета листов HD (облик `transfer`). */
    get coloured() {
      return Boolean(colours);
    },
    bounds: () => ({ min: [...min], max: [...max] }),
  };
}

/* ------------------------------------------------------------------ *
 * Карта текселей листа
 * ------------------------------------------------------------------ */

const NONE = 0;
const OWN = 1;
const FOREIGN = 2;
/* Тексель одной развёртки, чьи точки мира расходятся дальше этого (м), —
   общий для разных мест грани: наложения его не трогают (фикс 1 ТЗ
   06.10.2026 — у Мегамолла полосы баннера ложились на чужие стены). */
const SPREAD = 1.5;

/*
 * Лист под разметкой: чей тексель (своё место, чужое, никто) и облик своего.
 * Повторяющийся лист (развёртка больше листа в несколько раз) размечается
 * целиком по треугольнику — его тексели смотрят на весь мир сразу.
 */
function createSheetMarks(width, height) {
  return {
    width,
    height,
    owner: new Uint8Array(width * height),
    look: new Int32Array(width * height).fill(-1),
    /* Точка мира и нормаль своего текселя — для отделки по стенам. */
    points: null,
    /* Тексель, который развёртка кладёт на разные места мира (повтор,
       зеркало половин фасада): картинка «в одно место» — баннер, эмблема —
       на нём легла бы и туда, где её нет (`SPREAD`). */
    spread: null,
    /* Точка поля облика своего текселя — для облика `transfer`. */
    source: null,
    /* Треугольники, что накрывают лист целиком (повтор листа): их облик
       ложится на все тексели одним проходом в конце. `tiledOwn` — площадь
       своих граней по облику, `tiledLoose` — площадь своих граней, что
       выходят за поверхность места, `tiledForeign` — грань чужой модели. */
    tiledOwn: new Map(),
    tiledLoose: 0,
    tiledForeign: false,
    /* Лист — копия словаря только для своих моделей (изоляция). */
    exclusive: false,
  };
}

/*
 * Повторяющиеся треугольники — на весь лист. Грань чужой модели закрывает
 * лист. Своя грань, что выходит за поверхность места (площадка у ангара,
 * натянутая одним листом), закрывает общий лист игры; у копии словаря —
 * только если таких граней больше 40 % площади: копию видят одни свои
 * модели. Иначе — облик большинства по площади там, где своего ещё нет.
 */
function resolveTiled(marks) {
  const voted = [...marks.tiledOwn.values()].reduce((sum, value) => sum + value, 0);
  const loose = marks.tiledLoose > (marks.exclusive ? 0.4 * (voted + marks.tiledLoose) : 0);
  if (marks.tiledForeign || (voted && loose)) for (let index = 0; index < marks.owner.length; index += 1) marks.owner[index] |= FOREIGN;
  if (!marks.tiledOwn.size || marks.tiledForeign || loose) return;
  let best = -1;
  let weight = -1;
  for (const [look, count] of marks.tiledOwn)
    if (count > weight) {
      best = look;
      weight = count;
    }
  for (let index = 0; index < marks.owner.length; index += 1) {
    marks.owner[index] |= OWN;
    if (marks.look[index] < 0) marks.look[index] = best;
  }
}

/**
 * Треугольник в развёртку листа. `world` — точки мира вершин (или `null`
 * у чужих моделей без места), `classify(point)` → облик или −1.
 */
function rasterTriangle(marks, uv, world, normal, classify, { foreign = false } = {}) {
  const { width, height } = marks;
  const px = uv.map(([u]) => u * width - 0.5);
  const py = uv.map(([, v]) => v * height - 0.5);
  const minX = Math.floor(Math.min(...px));
  const maxX = Math.ceil(Math.max(...px));
  const minY = Math.floor(Math.min(...py));
  const maxY = Math.ceil(Math.max(...py));
  const area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
  if (!Number.isFinite(area) || Math.abs(area) < 1e-9) return;
  /*
   * Развёртка треугольника шире или выше самого листа — лист повторяется по
   * грани: его тексели смотрят на всю грань сразу — облик по центру грани,
   * на весь лист, одним проходом в конце. Большой треугольник без повтора
   * (земля, натянутая на весь атлас SLOD) размечается тексель за текселем:
   * иначе одна чужая грань закрыла бы весь атлас.
   */
  const facing = unit(normal);
  if (maxX - minX > width + 1 || maxY - minY > height + 1) {
    if (foreign || !world) {
      marks.tiledForeign = true;
      return;
    }
    /*
     * Облик грани — по семи точкам (вершины и середины рёбер, чуть внутрь,
     * и центр), с весом площади: точки на поверхности места голосуют за
     * свой облик, точки мимо неё — «выходит за место» (`resolveTiled`).
     * Нижняя сторона навеса (грань смотрит вниз) издалека не видна и не
     * решает ничего.
     */
    if (facing && facing[2] < -0.5) return;
    const e1 = [0, 1, 2].map((axis) => world[1][axis] - world[0][axis]);
    const e2 = [0, 1, 2].map((axis) => world[2][axis] - world[0][axis]);
    const faceArea =
      Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
    const centre = [0, 1, 2].map((axis) => (world[0][axis] + world[1][axis] + world[2][axis]) / 3);
    const samples = [centre];
    for (let k = 0; k < 3; k += 1) {
      const p = world[k];
      const q = world[(k + 1) % 3];
      samples.push([0, 1, 2].map((axis) => p[axis] + (centre[axis] - p[axis]) * 0.1));
      samples.push([0, 1, 2].map((axis) => (p[axis] + q[axis]) / 2 + (centre[axis] - (p[axis] + q[axis]) / 2) * 0.1));
    }
    const votes = new Map();
    let missing = 0;
    for (const point of samples) {
      const look = classify.at(point[0], point[1], point[2], facing);
      if (look < 0) missing += 1;
      else votes.set(look, (votes.get(look) || 0) + 1);
    }
    marks.tiledLoose += (faceArea * missing) / samples.length;
    for (const [look, count] of votes) marks.tiledOwn.set(look, (marks.tiledOwn.get(look) || 0) + (faceArea * count) / samples.length);
    return;
  }
  const own = !foreign && world;
  const [a, b, c] = own ? world : [null, null, null];
  const box = own ? classify.box : null;
  const { owner, look: looks, points, source } = marks;
  /* По строке барицентры линейны по x: строка проходится только внутри
     треугольника, а не по всей рамке (тонкий косой треугольник через весь
     атлас — миллион пустых шагов). */
  const inv = 1 / area;
  for (let y = minY; y <= maxY; y += 1) {
    const a0 = (px[1] * (py[2] - y) - px[2] * (py[1] - y)) * inv;
    const b0 = (py[1] - py[2]) * inv;
    const a1 = (px[2] * (py[0] - y) - px[0] * (py[2] - y)) * inv;
    const b1 = (py[2] - py[0]) * inv;
    let lo = minX;
    let hi = maxX;
    for (const [ai, bi] of [
      [a0, b0],
      [a1, b1],
      [1 - a0 - a1, -b0 - b1],
    ]) {
      if (bi > 1e-12) lo = Math.max(lo, (-1e-6 - ai) / bi);
      else if (bi < -1e-12) hi = Math.min(hi, (-1e-6 - ai) / bi);
      else if (ai < -1e-6) hi = lo - 1;
    }
    const first = Math.ceil(lo);
    const last = Math.floor(hi);
    if (first > last) continue;
    const row = (((y % height) + height) % height) * width;
    /* Чужая грань: только метка, столбец листа — шагом, без деления. */
    if (!own) {
      for (let x = first, tx = ((first % width) + width) % width; x <= last; x += 1, tx = tx + 1 === width ? 0 : tx + 1)
        owner[row + tx] |= FOREIGN;
      continue;
    }
    for (let x = first, tx = ((first % width) + width) % width; x <= last; x += 1, tx = tx + 1 === width ? 0 : tx + 1) {
      const w0 = a0 + b0 * x;
      const w1 = a1 + b1 * x;
      const w2 = 1 - w0 - w1;
      const index = row + tx;
      const X = a[0] * w0 + b[0] * w1 + c[0] * w2;
      const Y = a[1] * w0 + b[1] * w1 + c[1] * w2;
      const Z = a[2] * w0 + b[2] * w1 + c[2] * w2;
      /* Вдали от места (рамка поля плюс порог) — чужое без поиска. */
      const pick =
        X < box[0] || Y < box[1] || Z < box[2] || X > box[3] || Y > box[4] || Z > box[5] ? -1 : classify.pick(X, Y, Z, facing);
      const look = classify.lookOf(pick);
      if (look < 0) {
        /* Земля под самим зданием снаружи не видна — не чужая. */
        if (!classify.hidden?.(X, Y, Z)) owner[index] |= FOREIGN;
        continue;
      }
      owner[index] |= OWN;
      if (looks[index] < 0) {
        looks[index] = look;
        if (source) source[index] = pick;
        if (points) {
          const at = index * 6;
          points[at] = X;
          points[at + 1] = Y;
          points[at + 2] = Z;
          points[at + 3] = normal[0];
          points[at + 4] = normal[1];
          points[at + 5] = normal[2];
        }
      } else if (points && marks.spread) {
        const at = index * 6;
        const dx = points[at] - X;
        const dy = points[at + 1] - Y;
        const dz = points[at + 2] - Z;
        if (dx * dx + dy * dy + dz * dz > SPREAD * SPREAD) marks.spread[index] = 1;
      }
    }
  }
}

/*
 * Чужой треугольник метит лист только там, где есть свои тексели (с
 * запасом на растяжку `dilateOwn`): остальной атлас красить и так некому.
 * Лист, где своё может лечь целиком (повтор листа), метится весь. Блоки
 * своего считаются после разметки своих моделей.
 */
const BLOCK = 16;
function ownBlocks(marks) {
  if (marks.blocks !== undefined) return marks.blocks;
  if (marks.tiledOwn.size) return (marks.blocks = null);
  const columns = Math.ceil(marks.width / BLOCK);
  const rows = Math.ceil(marks.height / BLOCK);
  const cells = new Uint8Array(columns * rows);
  let any = false;
  for (let y = 0; y < marks.height; y += 1)
    for (let x = 0; x < marks.width; x += 1)
      if (marks.owner[y * marks.width + x] & OWN) {
        cells[Math.floor(y / BLOCK) * columns + Math.floor(x / BLOCK)] = 1;
        any = true;
      }
  return (marks.blocks = { columns, rows, cells, any });
}

function markForeign(marks, uv) {
  const blocks = ownBlocks(marks);
  if (blocks) {
    if (!blocks.any) return;
    const xs = uv.map(([u]) => u * marks.width);
    const ys = uv.map(([, v]) => v * marks.height);
    const minX = Math.floor(Math.min(...xs)) - 3;
    const maxX = Math.ceil(Math.max(...xs)) + 3;
    const minY = Math.floor(Math.min(...ys)) - 3;
    const maxY = Math.ceil(Math.max(...ys)) + 3;
    if (maxX - minX <= marks.width + 7 && maxY - minY <= marks.height + 7) {
      let hit = false;
      for (let by = Math.floor(minY / BLOCK); by <= Math.floor(maxY / BLOCK) && !hit; by += 1)
        for (let bx = Math.floor(minX / BLOCK); bx <= Math.floor(maxX / BLOCK) && !hit; bx += 1) {
          const column = ((bx % blocks.columns) + blocks.columns) % blocks.columns;
          const row = ((by % blocks.rows) + blocks.rows) % blocks.rows;
          if (blocks.cells[row * blocks.columns + column]) hit = true;
        }
      if (!hit) return;
    }
  }
  rasterTriangle(marks, uv, null, null, null, { foreign: true });
}

/*
 * Пыль: островок своих текселей меньше `DUST` (8 соседей) — не облик места,
 * а соседняя дорога или земля, задевшая порог одним-двумя текселями. Издалека
 * такой тексель — цветная точка на дороге; островок снимается до растяжки.
 */
const DUST = 6;
function clearDust(marks) {
  const { width, height, owner, look } = marks;
  const seen = new Uint8Array(owner.length);
  const stack = [];
  const island = [];
  let cleared = 0;
  for (let start = 0; start < owner.length; start += 1) {
    if (seen[start] || owner[start] !== OWN) continue;
    seen[start] = 1;
    stack.push(start);
    island.length = 0;
    while (stack.length) {
      const index = stack.pop();
      island.push(index);
      const x = index % width;
      const y = (index - x) / width;
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] || owner[next] !== OWN) continue;
          seen[next] = 1;
          stack.push(next);
        }
    }
    if (island.length >= DUST) continue;
    for (const index of island) {
      owner[index] = NONE;
      look[index] = -1;
    }
    cleared += island.length;
  }
  return cleared;
}

/* Растянуть свои тексели на пустые соседние (поля между островами
   развёртки): иначе фильтрация листа даст тонкий штатный край. */
function dilateOwn(marks, passes = 2) {
  const { width, height, owner, look } = marks;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = [];
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (owner[index] !== NONE) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const other = ny * width + nx;
          if (owner[other] === OWN) {
            next.push([index, other]);
            break;
          }
        }
      }
    for (const [index, from] of next) {
      owner[index] = OWN;
      look[index] = look[from];
      if (marks.points) marks.points.copyWithin(index * 6, from * 6, from * 6 + 6);
      if (marks.source) marks.source[index] = marks.source[from];
      if (marks.spread) marks.spread[index] = marks.spread[from];
    }
  }
}

/* Маска чужих пользователей листа из описи: `{ size: [w, h], bits }`. */
function applySharedMask(marks, shared) {
  if (!shared?.bits) return 0;
  const [mw, mh] = shared.size;
  const bits = Buffer.from(shared.bits, "base64");
  let blocked = 0;
  for (let y = 0; y < marks.height; y += 1)
    for (let x = 0; x < marks.width; x += 1) {
      const mx = Math.min(mw - 1, Math.floor((x / marks.width) * mw));
      const my = Math.min(mh - 1, Math.floor((y / marks.height) * mh));
      const bit = my * mw + mx;
      if (bits[bit >> 3] & (1 << (bit & 7))) {
        const index = y * marks.width + x;
        if (marks.owner[index] & OWN) blocked += 1;
        marks.owner[index] |= FOREIGN;
      }
    }
  return blocked;
}

/* ------------------------------------------------------------------ *
 * Облик текселей
 * ------------------------------------------------------------------ */

const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/* 75-й процентиль яркости своих текселей облика — опора тона. */
function referenceLuma(rgba, marks, lookId) {
  const histogram = new Float64Array(256);
  let total = 0;
  for (let index = 0; index < marks.owner.length; index += 1) {
    if (marks.owner[index] !== OWN || marks.look[index] !== lookId) continue;
    const at = index * 4;
    histogram[Math.round(luma(rgba[at], rgba[at + 1], rgba[at + 2]) * 255)] += 1;
    total += 1;
  }
  if (!total) return 0.5;
  let running = 0;
  for (let step = 0; step < 256; step += 1) {
    running += histogram[step];
    if (running / total >= 0.75) return Math.max(0.05, step / 255);
  }
  return 0.5;
}

function finishColour(op, point, normal) {
  const [s, t] = boxProjection(point, normal, op.box, op.metres ? { fit: "metres", metres: op.metres } : { fit: "stretch" });
  const source = op.source;
  if (source.width === source.height && source.kind !== "image") {
    const clampS = source.wrap ? s : Math.min(0.999, Math.max(0, s));
    const clampT = source.wrap ? 1 - t : Math.min(0.999, Math.max(0, 1 - t));
    return sampleTile(source.rgba, source.width, clampS, clampT);
  }
  return sampleImage(source.rgba, source.width, source.height, s, t, source.wrap);
}

/**
 * Облик своих текселей листа. `ops[look]`:
 *   `{ kind: "tint", colour, brightness?, lift? }` — тон по светотени листа
 *     (`lift` — подъём тёмного, как у `tintPixel`);
 *   `{ kind: "grey" }` — серый той же яркости (как в моде);
 *   `{ kind: "finish", source, box, metres, shade, origin }` — отделка по
 *     стенам в точке мира (минус `origin` — рамка сцены набора);
 *   `{ kind: "transfer", fallback }` — цвет того места листа HD, что под
 *     текселем (поле облика с цветами, `field`): градиент, радуга, перелив,
 *     картинка вдали те же, что вблизи; светотень дальнего листа остаётся
 *     (яркость текселя к яркости листа HD до правки). Нет цвета у точки —
 *     тон цвета `fallback`;
 *   `null` — как в игре.
 * Правит `rgba`; возвращает число перекрашенных текселей.
 */
export function paintSheet(rgba, marks, ops, field = null) {
  const tables = new Map();
  let painted = 0;
  for (let index = 0; index < marks.owner.length; index += 1) {
    if (marks.owner[index] !== OWN) continue;
    const lookId = marks.look[index];
    const op = ops[lookId];
    if (!op) continue;
    const at = index * 4;
    if (op.kind === "transfer") {
      const colour = marks.source && field ? field.colourAt(marks.source[index]) : null;
      if (!colour) {
        /* У поля есть цвета листов HD, а у этой точки нет: её лист набор не
           правит (опись листов места) — вдали он как в игре. Тон — только
           когда цветов у поля нет вовсе (листы не прочитались). */
        if (field?.coloured || !op.fallback) continue;
        const key = `fallback:${lookId}`;
        if (!tables.has(key)) tables.set(key, tintTable({ colour: op.fallback, ref: referenceLuma(rgba, marks, lookId), brightness: 1, lift: op.lift || 0 }));
        const table = tables.get(key);
        const step = Math.min(1023, Math.round(luma(rgba[at], rgba[at + 1], rgba[at + 2]) * 1023)) * 3;
        rgba[at] = table[step];
        rgba[at + 1] = table[step + 1];
        rgba[at + 2] = table[step + 2];
      } else {
        /* Место HD не правили — тексель как в игре. */
        if (Math.abs(colour[0] - colour[3]) < 4 && Math.abs(colour[1] - colour[4]) < 4 && Math.abs(colour[2] - colour[5]) < 4) continue;
        const shade = Math.min(2, Math.max(0.4, luma(rgba[at], rgba[at + 1], rgba[at + 2]) / Math.max(0.03, luma(colour[3], colour[4], colour[5]))));
        rgba[at] = Math.min(255, colour[0] * shade);
        rgba[at + 1] = Math.min(255, colour[1] * shade);
        rgba[at + 2] = Math.min(255, colour[2] * shade);
      }
    } else if (op.kind === "grey") {
      const value = luma(rgba[at], rgba[at + 1], rgba[at + 2]) * 255;
      rgba[at] = rgba[at + 1] = rgba[at + 2] = value;
    } else if (op.kind === "tint") {
      if (!tables.has(lookId))
        tables.set(lookId, tintTable({ colour: op.colour, ref: referenceLuma(rgba, marks, lookId), brightness: op.brightness ?? 1, lift: op.lift || 0 }));
      const table = tables.get(lookId);
      const step = Math.min(1023, Math.round(luma(rgba[at], rgba[at + 1], rgba[at + 2]) * 1023)) * 3;
      rgba[at] = table[step];
      rgba[at + 1] = table[step + 1];
      rgba[at + 2] = table[step + 2];
    } else if (op.kind === "finish" && (!marks.points || !(marks.points[index * 6 + 3] || marks.points[index * 6 + 4] || marks.points[index * 6 + 5]))) {
      /* Нет точки мира (лист на всю грань) — тон среднего цвета отделки. */
      if (!op.fallback) continue;
      const key = `fallback:${lookId}`;
      if (!tables.has(key))
        tables.set(key, tintTable({ colour: op.fallback, ref: referenceLuma(rgba, marks, lookId), brightness: 1 }));
      const table = tables.get(key);
      const step = Math.min(1023, Math.round(luma(rgba[at], rgba[at + 1], rgba[at + 2]) * 1023)) * 3;
      rgba[at] = table[step];
      rgba[at + 1] = table[step + 1];
      rgba[at + 2] = table[step + 2];
    } else if (op.kind === "finish") {
      const point = Array.from(marks.points.subarray(index * 6, index * 6 + 3)).map((value, axis) => value - (op.origin?.[axis] || 0));
      const normal = Array.from(marks.points.subarray(index * 6 + 3, index * 6 + 6));
      const colour = finishColour(op, point, normal);
      /* Опора светотени — своя у листа (75-й процентиль своих текселей), как у тона. */
      const refKey = `ref:${lookId}`;
      if (!op.ref && !tables.has(refKey)) tables.set(refKey, referenceLuma(rgba, marks, lookId));
      const ref = op.ref || tables.get(refKey) || 0.5;
      const share = (op.shade ?? 55) / 100;
      const factor = 1 + (Math.min(1.6, Math.max(0, luma(rgba[at], rgba[at + 1], rgba[at + 2]) / ref)) - 1) * share;
      rgba[at] = Math.min(255, colour[0] * factor);
      rgba[at + 1] = Math.min(255, colour[1] * factor);
      rgba[at + 2] = Math.min(255, colour[2] * factor);
    } else continue;
    painted += 1;
  }
  return painted;
}

/*
 * Наложения по плоскости — картинки, что стоят на стенах места своими
 * плашками или островами листа (баннеры сторон, логотипы, надпись здания):
 * у дальней модели их нет, и без наложения она показывала бы штатную стену.
 * `overlays` — `[{ point, normal, width, height, angle?, image: { rgba,
 * width, height }, opacity?, reach? }]` в координатах мира: тексель своей
 * поверхности, чья точка лежит на прямоугольнике (по нормали — ближе
 * `reach` метров, грань смотрит туда же), берёт цвет картинки в этой точке
 * (с её прозрачностью). Тексель, который развёртка кладёт на разные места
 * мира (`spread`), не трогается: картинка легла бы и туда, где её нет, — у
 * плашек для этого своя дальняя плашка (`withFarPlates`). Возвращает число
 * перекрашенных текселей.
 */
const OVERLAY_REACH = 3;
/* Кайма вокруг стёртого места, м: её средний цвет ложится на место. */
const ERASE_RING = 0.8;
export function paintOverlays(rgba, marks, overlays) {
  if (!marks.points || !overlays?.length) return 0;
  const all = overlays.map((overlay) => {
    const n = unit(overlay.normal) || [0, 0, 1];
    const helper = Math.abs(n[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
    let right = unit([helper[1] * n[2] - helper[2] * n[1], helper[2] * n[0] - helper[0] * n[2], helper[0] * n[1] - helper[1] * n[0]]);
    let up = [n[1] * right[2] - n[2] * right[1], n[2] * right[0] - n[0] * right[2], n[0] * right[1] - n[1] * right[0]];
    const angle = ((Number(overlay.angle) || 0) * Math.PI) / 180;
    if (angle) {
      const c = Math.cos(angle);
      const si = Math.sin(angle);
      [right, up] = [right.map((value, axis) => value * c + up[axis] * si), up.map((value, axis) => value * c - right[axis] * si)];
    }
    return { ...overlay, n, right, up, reach: overlay.reach ?? OVERLAY_REACH };
  });
  /* Стёртые места (`erase` — буквы, убранные из модели) — первыми: поверх
     них ложатся картинки (свои буквы). */
  let painted = eraseOverlays(rgba, marks, all.filter((frame) => frame.erase));
  const frames = all.filter((frame) => !frame.erase && frame.image);
  for (let index = 0; index < marks.owner.length; index += 1) {
    if (marks.owner[index] !== OWN || marks.spread?.[index]) continue;
    const at6 = index * 6;
    const size = Math.hypot(marks.points[at6 + 3], marks.points[at6 + 4], marks.points[at6 + 5]);
    if (!size) continue;
    const nx = marks.points[at6 + 3] / size;
    const ny = marks.points[at6 + 4] / size;
    const nz = marks.points[at6 + 5] / size;
    const px = marks.points[at6];
    const py = marks.points[at6 + 1];
    const pz = marks.points[at6 + 2];
    for (const frame of frames) {
      if (nx * frame.n[0] + ny * frame.n[1] + nz * frame.n[2] < FACING) continue;
      const dx = px - frame.point[0];
      const dy = py - frame.point[1];
      const dz = pz - frame.point[2];
      if (Math.abs(dx * frame.n[0] + dy * frame.n[1] + dz * frame.n[2]) > frame.reach) continue;
      const s = (dx * frame.right[0] + dy * frame.right[1] + dz * frame.right[2]) / frame.width + 0.5;
      const t = (dx * frame.up[0] + dy * frame.up[1] + dz * frame.up[2]) / frame.height + 0.5;
      if (s < 0 || s > 1 || t < 0 || t > 1) continue;
      const image = frame.image;
      const ix = Math.min(image.width - 1, Math.max(0, Math.floor(s * image.width)));
      const iy = Math.min(image.height - 1, Math.max(0, Math.floor((1 - t) * image.height)));
      const from = (iy * image.width + ix) * 4;
      const alpha = (image.rgba[from + 3] / 255) * (frame.opacity ?? 1);
      if (alpha <= 0.01) continue;
      const at = index * 4;
      rgba[at] = rgba[at] + (image.rgba[from] - rgba[at]) * alpha;
      rgba[at + 1] = rgba[at + 1] + (image.rgba[from + 1] - rgba[at + 1]) * alpha;
      rgba[at + 2] = rgba[at + 2] + (image.rgba[from + 2] - rgba[at + 2]) * alpha;
      painted += 1;
    }
  }
  return painted;
}

/*
 * Стереть место на дальнем листе: тексели своей поверхности в прямоугольнике
 * (лицом туда же, ближе `reach` по нормали) берут средний цвет каймы вокруг
 * него (`ERASE_RING` метров) — стена без букв, тем же тоном, что рядом.
 */
function eraseOverlays(rgba, marks, frames) {
  if (!frames.length) return 0;
  const sums = frames.map(() => [0, 0, 0, 0]);
  const inside = frames.map(() => []);
  for (let index = 0; index < marks.owner.length; index += 1) {
    if (marks.owner[index] !== OWN || marks.spread?.[index]) continue;
    const at6 = index * 6;
    const size = Math.hypot(marks.points[at6 + 3], marks.points[at6 + 4], marks.points[at6 + 5]);
    if (!size) continue;
    const normal = [marks.points[at6 + 3] / size, marks.points[at6 + 4] / size, marks.points[at6 + 5] / size];
    frames.forEach((frame, frameIndex) => {
      if (normal[0] * frame.n[0] + normal[1] * frame.n[1] + normal[2] * frame.n[2] < FACING) return;
      const d = [marks.points[at6] - frame.point[0], marks.points[at6 + 1] - frame.point[1], marks.points[at6 + 2] - frame.point[2]];
      if (Math.abs(d[0] * frame.n[0] + d[1] * frame.n[1] + d[2] * frame.n[2]) > frame.reach) return;
      const s = (d[0] * frame.right[0] + d[1] * frame.right[1] + d[2] * frame.right[2]) / frame.width + 0.5;
      const t = (d[0] * frame.up[0] + d[1] * frame.up[1] + d[2] * frame.up[2]) / frame.height + 0.5;
      const ringS = ERASE_RING / frame.width;
      const ringT = ERASE_RING / frame.height;
      if (s < -ringS || s > 1 + ringS || t < -ringT || t > 1 + ringT) return;
      if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
        inside[frameIndex].push(index);
        return;
      }
      const at = index * 4;
      const sum = sums[frameIndex];
      sum[0] += rgba[at];
      sum[1] += rgba[at + 1];
      sum[2] += rgba[at + 2];
      sum[3] += 1;
    });
  }
  let painted = 0;
  frames.forEach((_, frameIndex) => {
    const sum = sums[frameIndex];
    if (!sum[3]) return;
    const colour = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
    for (const index of inside[frameIndex]) {
      const at = index * 4;
      rgba[at] = colour[0];
      rgba[at + 1] = colour[1];
      rgba[at + 2] = colour[2];
      painted += 1;
    }
  });
  return painted;
}

/* ------------------------------------------------------------------ *
 * Сборка файлов
 * ------------------------------------------------------------------ */

const kindOf = (name) => String(name).toLowerCase().split(".").pop();
const fileNameOf = (address) => String(address).split("/").pop().toLowerCase();

function drawablesOf(bytes, kind) {
  return readDrawable(openResourceWith(bytes, inflateRaw), { inflateRaw, kind }).drawables;
}

export function worldTriangles(drawable, placement) {
  const place = placementTransform(placement);
  const out = [];
  for (const mesh of drawable.meshes || []) {
    const texture = String(mesh.material?.textures?.diffuse || "").toLowerCase();
    if (!texture || !mesh.uvs) continue;
    const points = [];
    for (let at = 0; at < mesh.positions.length; at += 3)
      points.push(place(toGame(mesh.positions[at], mesh.positions[at + 1], mesh.positions[at + 2])));
    for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
      const ids = [mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]];
      const [a, b, c] = ids.map((id) => points[id]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const length = Math.hypot(...n) || 1;
      out.push({
        texture,
        /* Свечение (огни окон ночью): вблизи его не красят — и вдали тоже. */
        emissive: Boolean(mesh.material?.emissive),
        world: [a, b, c],
        normal: n.map((value) => value / length),
        uv: ids.map((id) => [mesh.uvs[id * 2], mesh.uvs[id * 2 + 1]]),
        min: [0, 1, 2].map((axis) => Math.min(a[axis], b[axis], c[axis])),
        max: [0, 1, 2].map((axis) => Math.max(a[axis], b[axis], c[axis])),
      });
    }
  }
  return out;
}

function uvTriangles(drawable) {
  const out = [];
  for (const mesh of drawable.meshes || []) {
    const texture = String(mesh.material?.textures?.diffuse || "").toLowerCase();
    if (!texture || !mesh.uvs) continue;
    for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
      const ids = [mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]];
      out.push({ texture, uv: ids.map((id) => [mesh.uvs[id * 2], mesh.uvs[id * 2 + 1]]) });
    }
  }
  return out;
}

/*
 * Типы (`.ytyp`): архетипу — другой словарь текстур, а если надо, и другой
 * словарь моделей. Хеши имён лежат в `CBaseArchetypeDef` по смещениям 92
 * (`textureDictionary`) и 100 (`drawableDictionary`, CodeWalker `MetaTypes`);
 * длина файла та же, ресурс пережимается с прежним заголовком. `changes` —
 * `Map(архетип → хеш словаря текстур | { txd, ydd })`.
 */
export function patchArchetypeDictionaries(bytes, changes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateRaw);
  if (resource.version !== 2) throw new Error("Файл типов — не Meta-ресурс.");
  const data = new DataView(resource.data.buffer, resource.data.byteOffset, resource.data.byteLength);
  const view = resource.view;
  const rootAt = resource.at(resource.root);
  const blocksAt = resource.at(view.getBigUint64(rootAt + 0x30, true));
  const blockCount = view.getInt16(rootAt + 0x4c, true);
  const rootBlock = view.getInt32(rootAt + 0x1c, true);
  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const at = blocksAt + index * 16;
    blocks.push({ dataAt: resource.at(view.getBigUint64(at + 8, true)) });
  }
  const resolve = (pointer) => {
    const block = blocks[Number(pointer & 0xfffn) - 1];
    return block ? block.dataAt + Number((pointer >> 12n) & 0xfffffn) : -1;
  };
  const typesAt = blocks[rootBlock - 1]?.dataAt;
  if (typesAt == null) throw new Error("Корень файла типов не найден.");
  const listAt = resolve(view.getBigUint64(typesAt + 24, true));
  const count = view.getUint16(typesAt + 32, true);
  let patched = 0;
  for (let index = 0; index < count && listAt >= 0; index += 1) {
    const at = resolve(view.getBigUint64(listAt + index * 8, true));
    if (at < 0) continue;
    const name = view.getUint32(at + 88, true);
    const next = changes.get(name >>> 0);
    if (next == null) continue;
    const { txd, ydd = null } = typeof next === "object" ? next : { txd: next };
    data.setUint32(at + 92, txd >>> 0, true);
    if (ydd != null) data.setUint32(at + 100, ydd >>> 0, true);
    patched += 1;
  }
  if (!patched) return null;
  const compressed = deflateRaw(resource.data, { level: zlib.constants.Z_BEST_COMPRESSION });
  const out = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(out, 0);
  compressed.copy(out, RSC7_HEADER_BYTES);
  return { bytes: out, patched };
}

/**
 * Файлы дальней прорисовки под облик работы.
 *
 * `lod` — опись набора (`resources/recolor-lod/<набор>.json`: `levels`,
 * `shared` — маски чужих пользователей листов, `isolate` — словари под
 * копию), `game.read(адрес)` — файлы игры, `field` — поле облика, `ops` —
 * операции по номерам облика, `wantsPoints` — нужны ли точки мира (отделка
 * по стенам), `interior` — номера обликов нутра: с SLOD2 и дальше нутра не
 * видно, и грубым коробкам их облик не достаётся. Возвращает `{ files,
 * report }`: `files` — `[{ name, bytes }]` правленых файлов, `report` — что
 * сделано.
 */
/*
 * `reach` — свои пороги набора поверх `LOD_REACH` (`{ уровень: { xy, z } }`):
 * у мест с грубыми дальними моделями (бункеры и силосы завода) поверхность
 * LOD отходит от HD дальше общего порога.
 *
 * `sheetEdits` — правки листа до покраски: `[{ sheet: "<словарь>/<лист>",
 * edit(rgba, width, height) → число правленых текселей }]` (граффити,
 * запечённые в дальний лист завода, задача 11 ТЗ 17.10.2026). Только у копии
 * словаря (`lod.isolate`): её видят одни свои модели, а лист игры делят и
 * соседи.
 */
export async function buildLodFiles({ lod, game, field, ops, wantsPoints = false, interior = [], overlays = [], reach: reaches = null, sheetEdits = [] }) {
  const inside = interior.length ? new Set(interior) : null;
  /* Наложениям нужна точка мира каждого текселя. */
  if (overlays.length) wantsPoints = true;
  const report = { levels: [], files: [], sheets: [], skipped: [], blockedTexels: 0, paintedTexels: 0, isolated: [] };
  if (!lod?.levels?.length || !game || !field?.count) return { files: [], report };
  const files = new Map();
  async function fileAt(address) {
    if (!files.has(address)) {
      const bytes = await game.read(address).catch(() => null);
      files.set(address, bytes ? { address, name: fileNameOf(address), bytes: new Uint8Array(bytes), drawables: null, refs: null } : null);
    }
    return files.get(address);
  }

  /* Свои модели LOD, которым словарь подменяется копией. */
  const isolatedBy = new Map();
  for (const entry of lod.isolate || []) for (const hash of entry.archetypes || []) isolatedBy.set(hash >>> 0, entry);

  /*
   * Листы по месту хранения: файл модели (вложенный лист), словарь игры или
   * копия словаря (`copy:<имя>` — те же байты, что у словаря игры).
   */
  const sheets = new Map();
  async function sheetOf(address, texture, kind, { source = address, copy = null } = {}) {
    const key = `${address}|${texture}`;
    if (sheets.has(key)) return sheets.get(key);
    const file = await fileAt(source);
    let ref = null;
    if (file) {
      if (!file.refs) {
        const resource = openResourceWith(file.bytes, inflateRaw);
        file.refs =
          kind === "ytd"
            ? readTextureDictionary(resource)
            : (file.drawables || drawablesOf(file.bytes, kind)).flatMap((drawable) => drawable.embeddedTextures || []);
      }
      ref = file.refs.find((item) => item.name.toLowerCase() === texture && item.complete) || null;
    }
    const entry = ref ? { address, source, copy, texture, ref, kind, marks: createSheetMarks(ref.width, ref.height) } : null;
    if (entry && copy) entry.marks.exclusive = true;
    if (entry && wantsPoints) {
      entry.marks.points = new Float32Array(ref.width * ref.height * 6);
      entry.marks.spread = new Uint8Array(ref.width * ref.height);
    }
    /* Облик `transfer` берёт цвет листа HD из точки поля своего текселя. */
    if (entry && field.coloured) entry.marks.source = new Int32Array(ref.width * ref.height).fill(-1);
    sheets.set(key, entry);
    return entry;
  }

  /*
   * Облик точки мира с кэшем по клеткам в четверть порога: соседние тексели
   * одной грани смотрят в одну клетку, и ближайшая точка поля ищется один
   * раз на клетку, а не на тексель.
   */
  const classifiers = new Map();
  function classifierFor(reach, skip = null) {
    const id = `${reach.xy}/${reach.z}|${skip ? "outer" : "all"}`;
    if (classifiers.has(id)) return classifiers.get(id);
    const cell = Math.max(0.25, reach.xy / 4);
    const cellZ = Math.max(0.25, reach.z / 4);
    const bounds = field.bounds();
    const box = [
      bounds.min[0] - reach.xy,
      bounds.min[1] - reach.xy,
      bounds.min[2] - reach.z,
      bounds.max[0] + reach.xy,
      bounds.max[1] + reach.xy,
      bounds.max[2] + reach.z,
    ];
    /* Ответы по стороне грани (по 0,25 на ось), внутри — по клетке мира:
       тексели одной грани делят и сторону, и клетки. */
    const sides = new Map();
    const byNormal = new WeakMap();
    const anySide = new Map();
    const classify = {
      box,
      hidden: (x, y, z) => field.hidden(x, y, z),
      lookOf: (index) => field.lookOf(index),
      /* Точка поля, чей облик берёт точка мира (−1 — своей поверхности нет). */
      pick(x, y, z, normal = null) {
        let cache = anySide;
        if (normal) {
          cache = byNormal.get(normal);
          if (!cache) {
            const side = `${Math.round(normal[0] * 4)},${Math.round(normal[1] * 4)},${Math.round(normal[2] * 4)}`;
            cache = sides.get(side);
            if (!cache) sides.set(side, (cache = new Map()));
            byNormal.set(normal, cache);
          }
        }
        const key = (Math.floor(x / cell) + 32768) * 4294967296 + (Math.floor(y / cell) + 32768) * 65536 + (Math.floor(z / cellZ) + 32768);
        let index = cache.get(key);
        if (index === undefined) {
          index = field.nearestIndex(x, y, z, reach, normal, skip);
          cache.set(key, index);
        }
        return index;
      },
      at(x, y, z, normal = null) {
        return field.lookOf(classify.pick(x, y, z, normal));
      },
    };
    classifiers.set(id, classify);
    return classify;
  }

  /* 1. Свои модели цепочки и соседи — на места, тексели по полю; их грани
        вдали от места — чужие, метятся после (`markForeign`). */
  const placedKeys = new Set();
  const distant = [];
  for (const level of lod.levels) {
    if (!level.model?.at) continue;
    const file = await fileAt(level.model.at);
    if (!file) {
      if (!level.context) report.skipped.push(`${level.name}: файла ${level.model.at} нет в игре`);
      continue;
    }
    file.drawables ||= drawablesOf(file.bytes, level.model.kind);
    const drawable =
      level.model.kind === "ydd" ? file.drawables.find((item) => item.hash >>> 0 === level.model.drawable) : file.drawables[0];
    if (!drawable) {
      if (!level.context) report.skipped.push(`${level.name}: модели нет в ${file.name}`);
      continue;
    }
    placedKeys.add(`${level.model.at}#${drawable.hash >>> 0}`);
    const embedded = new Set((drawable.embeddedTextures || []).map((item) => item.name.toLowerCase()));
    const isolated = isolatedBy.get(level.archetype >>> 0) || null;
    /* Свой порог набора — только своей цепочке: соседи (отбойники у
       дороги) с ним взяли бы облик места в общем словаре игры. */
    const reach = (!level.context && reaches?.[level.level]) || reachOf(level.level);
    /* SLOD2 и дальше — без облика нутра: с километра в распахнутые ворота
       не заглянуть, а грубая коробка взяла бы облик ферм. LOD и SLOD1 нутро
       видят (ворота ангара открыты). */
    const classify = classifierFor(reach, level.level >= 3 ? inside : null);
    let near = 0;
    let total = 0;
    for (const triangle of worldTriangles(drawable, level.placement)) {
      total += 1;
      let sheet = null;
      if (embedded.has(triangle.texture)) sheet = await sheetOf(level.model.at, triangle.texture, level.model.kind);
      else if (isolated) sheet = await sheetOf(`copy:${isolated.copy}`, triangle.texture, "ytd", { source: isolated.at, copy: isolated });
      else if (level.txd?.at) sheet = await sheetOf(level.txd.at, triangle.texture, "ytd");
      if (!sheet) continue;
      const touching = field.touches(triangle.min, triangle.max, reach);
      /* Огни окон ночью — не облик места: их лист только бережётся, как
         чужой (вблизи стекло и свечение не красятся). */
      if (!touching || triangle.emissive) {
        distant.push([sheet.marks, triangle.uv]);
        continue;
      }
      near += 1;
      rasterTriangle(sheet.marks, triangle.uv, triangle.world, triangle.normal, classify);
    }
    if (!level.context || near)
      report.levels.push({ level: level.levelName, name: level.name, file: file.name, triangles: total, near, context: Boolean(level.context) });
  }

  for (const [marks, uv] of distant) markForeign(marks, uv);

  /* 2. Остальные модели тех же файлов (без места — чужие) — только в листы
        словарей игры: копию словаря берут лишь наши модели. */
  for (const file of files.values()) {
    if (!file?.drawables) continue;
    for (const drawable of file.drawables) {
      if (placedKeys.has(`${file.address}#${drawable.hash >>> 0}`)) continue;
      const embedded = new Set((drawable.embeddedTextures || []).map((item) => item.name.toLowerCase()));
      for (const triangle of uvTriangles(drawable)) {
        if (embedded.has(triangle.texture)) continue;
        for (const sheet of sheets.values())
          if (sheet && sheet.kind === "ytd" && !sheet.copy && sheet.texture === triangle.texture)
            markForeign(sheet.marks, triangle.uv);
      }
    }
  }

  /* 3. Маски подготовки (кроме копий) и покраска. */
  const replacements = new Map();
  for (const sheet of sheets.values()) {
    if (!sheet) continue;
    const label = `${fileNameOf(sheet.source).replace(/\.[a-z0-9]+$/, "")}/${sheet.texture}`;
    if (!sheet.copy) report.blockedTexels += applySharedMask(sheet.marks, lod.shared?.[label]);
    /* Повтор листа — для отчёта: площадь своих граней, граней мимо места и чужие. */
    const tiled = sheet.marks.tiledOwn.size || sheet.marks.tiledLoose || sheet.marks.tiledForeign
      ? {
          own: Math.round([...sheet.marks.tiledOwn.values()].reduce((sum, value) => sum + value, 0)),
          loose: Math.round(sheet.marks.tiledLoose),
          foreign: sheet.marks.tiledForeign,
        }
      : null;
    resolveTiled(sheet.marks);
    clearDust(sheet.marks);
    dilateOwn(sheet.marks);
    let rgba;
    try {
      rgba = new Uint8ClampedArray(decodeTextureRef(sheet.ref, { level: 0 }).rgba);
    } catch {
      report.skipped.push(`${label}: формат ${sheet.ref.format} не читается`);
      continue;
    }
    const original = rgba.slice();
    let edited = 0;
    if (sheet.copy) for (const item of sheetEdits) if (item.sheet === label) edited += item.edit(rgba, sheet.ref.width, sheet.ref.height) || 0;
    const painted = edited + paintSheet(rgba, sheet.marks, ops, field) + paintOverlays(rgba, sheet.marks, overlays);
    /* Разметка листа — для отчёта: свои, чужие и общие тексели. */
    let own = 0;
    let shared = 0;
    for (const owner of sheet.marks.owner) {
      if (owner === OWN) own += 1;
      else if (owner === (OWN | FOREIGN)) shared += 1;
    }
    if (own || shared) report.sheets.push({ sheet: label, own, shared, painted, ...(tiled ? { tiled } : {}), ...(sheet.copy ? { copy: true } : {}) });
    if (!painted) continue;
    let payload;
    try {
      /* Пережимаются только тронутые блоки: остальной атлас квартала — байты игры. */
      payload = texturePayload(
        { name: sheet.ref.name, format: sheet.ref.format, width: sheet.ref.width, height: sheet.ref.height, levels: sheet.ref.levels, bytes: sheet.ref.bytes },
        rgba,
        { original, originalData: sheet.ref.resource.data.subarray(sheet.ref.dataAt, sheet.ref.dataAt + sheet.ref.bytes) },
      );
    } catch {
      report.skipped.push(`${label}: формат ${sheet.ref.format} не пишется`);
      continue;
    }
    report.paintedTexels += painted;
    const list = replacements.get(sheet.address) || { sheet, textures: {} };
    list.textures[sheet.ref.name] = payload;
    replacements.set(sheet.address, list);
  }

  const out = [];
  for (const [address, { sheet, textures }] of replacements) {
    const file = files.get(sheet.source);
    const { bytes } = patchResourceTextures(file.bytes, file.name, textures);
    const name = sheet.copy ? `${sheet.copy.copy}.ytd` : file.name;
    out.push({ name, bytes: Buffer.from(bytes) });
    report.files.push({ name, textures: Object.keys(textures).length });
    void address;
  }

  /* 4. Типы: нашим моделям LOD — копия словаря (если копия вообще едет). */
  const shippedCopies = new Set(out.map((file) => file.name));
  const byYtyp = new Map();
  for (const entry of lod.isolate || []) {
    if (!shippedCopies.has(`${entry.copy}.ytd`)) continue;
    const hash = joaatName(entry.copy);
    /* Словарь моделей, который наши модели делят с чужими (`ydds`), едет
       копией: у словаря моделей один словарь текстур на всех, и без своей
       копии наши модели LOD копию листов в игре не получают. Берётся
       правленый словарь моделей набора, если он едет, иначе — из игры. */
    const yddOf = new Map();
    for (const ydd of entry.ydds || []) {
      const shipped = out.find((file) => file.name === fileNameOf(ydd.at));
      const bytes = shipped ? shipped.bytes : await game.read(ydd.at).catch(() => null);
      if (!bytes) {
        report.skipped.push(`${fileNameOf(ydd.at)}: словаря моделей нет в игре — копия словаря листов до моделей LOD не дойдёт`);
        continue;
      }
      out.push({ name: `${ydd.copy}.ydd`, bytes: Buffer.from(bytes) });
      report.files.push({ name: `${ydd.copy}.ydd`, copyOf: fileNameOf(ydd.at) });
      const yddHash = joaatName(ydd.copy);
      for (const archetype of ydd.archetypes || []) yddOf.set(archetype >>> 0, yddHash);
    }
    for (const ytyp of entry.ytyps || []) {
      const changes = byYtyp.get(ytyp) || new Map();
      for (const archetype of entry.archetypes || []) {
        const ydd = yddOf.get(archetype >>> 0);
        changes.set(archetype >>> 0, ydd == null ? hash : { txd: hash, ydd });
      }
      byYtyp.set(ytyp, changes);
    }
  }
  for (const [address, changes] of byYtyp) {
    const bytes = await game.read(address).catch(() => null);
    if (!bytes) {
      report.skipped.push(`${fileNameOf(address)}: файла типов нет в игре — копия словаря не подключена`);
      continue;
    }
    const patched = patchArchetypeDictionaries(new Uint8Array(bytes), changes);
    if (!patched) continue;
    out.push({ name: fileNameOf(address), bytes: patched.bytes });
    report.isolated.push({ ytyp: fileNameOf(address), archetypes: patched.patched });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { files: out, report };
}

/*
 * Цвета листов HD для поля облика (облик `transfer`, фикс 1 ТЗ 06.10.2026).
 *
 * Лист — тот, что рисует грань вблизи: правленый (из собранных файлов
 * набора `files`) и штатный (из игры). Читается мелкой ступенью mip — до
 * `SAMPLE_SIDE` точек по стороне: цвет точки поля — среднее листа вокруг
 * неё, рисунок мельче полуметра вдали всё равно не виден.
 *
 * `records` — где лежит лист: `Map(имя листа → { file, at })` (опись
 * набора). `prepare()` читает все листы заранее — колбэк поля синхронный.
 */
const SAMPLE_SIDE = 32;
export function createSurfaceSampler({ game, files = [], records = new Map() }) {
  const built = new Map(files.map((file) => [String(file.name).toLowerCase(), file.bytes]));
  const sheets = new Map();
  const texturesOf = (bytes, name) => {
    const kind = kindOf(name);
    const resource = openResourceWith(new Uint8Array(bytes), inflateRaw);
    return kind === "ytd" ? readTextureDictionary(resource) : drawablesOf(new Uint8Array(bytes), kind).flatMap((drawable) => drawable.embeddedTextures || []);
  };
  const decode = (refs, texture) => {
    const ref = refs.find((item) => item.name.toLowerCase() === texture && item.complete);
    if (!ref) return null;
    try {
      const image = decodeTextureRef(ref, { maxSize: SAMPLE_SIDE });
      return image?.rgba ? image : null;
    } catch {
      return null;
    }
  };
  async function prepare() {
    const byFile = new Map();
    for (const [texture, record] of records) {
      if (!record?.at || !record?.file) continue;
      const list = byFile.get(record.at) || { record, textures: [] };
      list.textures.push(String(texture).toLowerCase());
      byFile.set(record.at, list);
    }
    for (const [at, { record, textures }] of byFile) {
      const original = await game.read(at).catch(() => null);
      if (!original) continue;
      let stockRefs;
      let paintedRefs;
      try {
        stockRefs = texturesOf(original, record.file);
        const painted = built.get(String(record.file).toLowerCase());
        paintedRefs = painted ? texturesOf(painted, record.file) : stockRefs;
      } catch {
        continue;
      }
      for (const texture of textures) {
        const stock = decode(stockRefs, texture);
        const painted = paintedRefs === stockRefs ? stock : decode(paintedRefs, texture);
        if (stock && painted) sheets.set(texture, { stock, painted });
      }
    }
    return sheets.size;
  }
  /* Билинейно, с повтором листа (развёртка плиткой выходит за 0…1). */
  const bilinear = (image, u, v, out, offset) => {
    const { width, height, rgba } = image;
    const x = (((u % 1) + 1) % 1) * width - 0.5;
    const y = (((v % 1) + 1) % 1) * height - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    for (let channel = 0; channel < 3; channel += 1) {
      let sum = 0;
      for (const [dx, dy, weight] of [
        [0, 0, (1 - fx) * (1 - fy)],
        [1, 0, fx * (1 - fy)],
        [0, 1, (1 - fx) * fy],
        [1, 1, fx * fy],
      ]) {
        const px = (((x0 + dx) % width) + width) % width;
        const py = (((y0 + dy) % height) + height) % height;
        sum += rgba[(py * width + px) * 4 + channel] * weight;
      }
      out[offset + channel] = sum;
    }
  };
  /** Колбэк поля: `(mesh)` → `sample(u, v)` → `[после × 3, до × 3]` или `null`. */
  function colourOf(mesh) {
    const diffuse = (mesh.material?.samplers || []).find((sampler) => sampler.role === "diffuse" && sampler.texture)?.texture || mesh.material?.textures?.diffuse;
    const sheet = diffuse ? sheets.get(String(diffuse).toLowerCase()) : null;
    if (!sheet) return null;
    return (u, v) => {
      const out = new Float32Array(6);
      bilinear(sheet.painted, u, v, out, 0);
      bilinear(sheet.stock, u, v, out, 3);
      return out;
    };
  }
  return { prepare, colourOf, get size() { return sheets.size; } };
}

/* Хеш имени, как его считает игра (Jenkins one-at-a-time, строчными). */
export function joaatName(text) {
  let hash = 0;
  for (const char of String(text).toLowerCase()) {
    hash = (hash + char.charCodeAt(0)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  return (hash + (hash << 15)) >>> 0;
}

/** Имена файлов, которые может привезти цепочка (для проверки доверия). */
export function lodFileNames(lod) {
  const names = new Set();
  for (const level of lod?.levels || []) {
    if (level.model?.at) names.add(fileNameOf(level.model.at));
    if (level.txd?.at) names.add(fileNameOf(level.txd.at));
  }
  for (const entry of lod?.isolate || []) {
    names.add(`${entry.copy}.ytd`);
    for (const ytyp of entry.ytyps || []) names.add(fileNameOf(ytyp));
  }
  return [...names].sort();
}

export { kindOf as lodFileKind };

/* ------------------------------------------------------------------ *
 * Дальние плашки
 * ------------------------------------------------------------------ */

/* Дальность дальней плашки, м: здание видно дальними моделями до SLOD3, а
   картинка во много метров ещё читается за пару километров. 5 км — предел
   хоста для той же плашки (`EmblemPlateCommands.cs`): прежде за 3 км баннер
   и логотип пропадали, а покрашенное здание оставалось (задача 7 ТЗ 10.10.2026). */
export const FAR_PLATE_LOD_DIST = 5000;
/* Отступ дальней плашки перед поверхностью дальних моделей, м, и пределы. */
const FAR_PLATE_MARGIN = 0.15;
const FAR_PLATE_MIN = 0.2;
const FAR_PLATE_MAX = 4;
/* Какие грани дальних моделей — «та же стена»: смотрят туда же и лежат не
   дальше этого от плоскости плашки (м). */
const FAR_PLATE_SLAB = 8;

/**
 * Плашки места (`compile-emblem-plates`) с дальними копиями (фикс 1 ТЗ
 * 06.10.2026): плашка — картинка «в одно место» (баннер, логотип, своя
 * надпись) — видна, пока видна HD-модель здания; дальше игра рисует
 * здание дальними моделями, и плашка пропадала. Дальняя копия встаёт
 * чуть впереди стен дальних моделей (90-й процентиль выступа их граней,
 * что смотрят туда же, в прямоугольнике плашки, по всем уровням цепочки
 * `lod`), видна до `lodDist` и сменяет HD-плашку на её дальности.
 * Без описи LOD — небольшой отступ от стены. `game.read(адрес)` — модели
 * уровней. Возвращает новые плашки (`far: { position, lodDist }`).
 */
export async function withFarPlates(plates, { lod = null, game = null, lodDist = FAR_PLATE_LOD_DIST } = {}) {
  const list = (plates || []).filter(Boolean);
  if (!list.length) return list;
  const surfaces = [];
  if (lod?.levels?.length && game) {
    const files = new Map();
    for (const level of lod.levels) {
      if (!level.model?.at) continue;
      if (!files.has(level.model.at)) {
        const bytes = await game.read(level.model.at).catch(() => null);
        let drawables = [];
        try {
          drawables = bytes ? drawablesOf(new Uint8Array(bytes), level.model.kind || kindOf(level.model.at)) : [];
        } catch {
          drawables = [];
        }
        files.set(level.model.at, drawables);
      }
      const drawables = files.get(level.model.at);
      const drawable = level.model.kind === "ydd" ? drawables.find((item) => item.hash >>> 0 === level.model.drawable >>> 0) : drawables[0];
      if (!drawable) continue;
      for (const triangle of worldTriangles(drawable, level.placement)) surfaces.push(triangle);
    }
  }
  return list.map((plate) => {
    const place = placementTransform({ position: [0, 0, 0], rotation: plate.rotation, scaleXY: 1, scaleZ: 1 });
    /* Лицо плашки смотрит в −Y модели. */
    const normal = place([0, -1, 0]);
    const right = place([1, 0, 0]);
    const up = place([0, 0, 1]);
    const [halfWidth, halfHeight] = [plate.size[0] / 2, plate.size[1] / 2];
    const heights = [];
    for (const triangle of surfaces) {
      if (triangle.normal[0] * normal[0] + triangle.normal[1] * normal[1] + triangle.normal[2] * normal[2] < 0.8) continue;
      /* Точки треугольника: вершины, середины рёбер, центр. */
      const [a, b, c] = triangle.world;
      const samples = [a, b, c, mid(a, b), mid(b, c), mid(c, a), [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]];
      for (const point of samples) {
        const d = [point[0] - plate.position[0], point[1] - plate.position[1], point[2] - plate.position[2]];
        const s = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
        const t = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
        if (Math.abs(s) > halfWidth || Math.abs(t) > halfHeight) continue;
        const h = d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2];
        if (Math.abs(h) <= FAR_PLATE_SLAB) heights.push(h);
      }
    }
    heights.sort((x, y) => x - y);
    const p90 = heights.length ? heights[Math.min(heights.length - 1, Math.floor(heights.length * 0.9))] : 0;
    const offset = Math.min(FAR_PLATE_MAX, Math.max(FAR_PLATE_MIN, p90 + FAR_PLATE_MARGIN));
    const round = (value) => Math.round(value * 1000) / 1000;
    return {
      ...plate,
      far: {
        position: plate.position.map((value, axis) => round(value + normal[axis] * offset)),
        lodDist: Math.max(lodDist, (plate.lodDist || 0) + 1),
      },
    };
  });
}

const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];

/* ------------------------------------------------------------------ *
 * Картинка поверх деталей стены (задача 11 ТЗ 10.10.2026)
 * ------------------------------------------------------------------ */

/* Запас на ткань, м: насколько полотно в игре отходит от своей модели
   (проверка в игре 10.10.2026: при 35 см низ полотна ещё заходил на картинку). */
const CLOTH_SWAY = 0.6;

/* Рамка плашки (`compile-emblem-plates`): лицо смотрит в −Y модели. */
function plateFrame(plate) {
  const place = placementTransform({ position: [0, 0, 0], rotation: plate.rotation, scaleXY: 1, scaleZ: 1 });
  return { point: plate.position, normal: place([0, -1, 0]), right: place([1, 0, 0]), up: place([0, 0, 1]), width: plate.size[0], height: plate.size[1] };
}

/**
 * Грани моделей HD места рядом с плашками: `{ solid, cloth }` — по
 * `Float32Array` по 9 чисел (ткань — отдельно, у неё свой запас).
 * `placements` — `[{ at?, position, rotation, scaleXY, scaleZ, ... }]`,
 * `read(placement)` → байты модели (правленые из пакета, иначе из игры) или
 * `null`; берутся только грани у плашек (их прямоугольник с запасом
 * `radius` метров).
 */
export async function nearPlateTriangles(plates, placements, read, { radius = 2 } = {}) {
  const list = (plates || []).filter(Boolean);
  if (!list.length) return { solid: new Float32Array(0), cloth: new Float32Array(0) };
  const spheres = list.map((plate) => ({ centre: plate.position, reach: Math.hypot(plate.size[0], plate.size[1]) / 2 + radius }));
  const near = (min, max) =>
    spheres.some(({ centre, reach }) => [0, 1, 2].every((axis) => centre[axis] + reach >= min[axis] && centre[axis] - reach <= max[axis]));
  const drawables = new Map();
  const out = [];
  const clothOut = [];
  for (const placement of placements || []) {
    const key = placement.at || placement.model || "";
    if (!key) continue;
    if (!drawables.has(key)) {
      const bytes = await Promise.resolve()
        .then(() => read(placement))
        .catch(() => null);
      let drawable = null;
      try {
        drawable = bytes ? drawablesOf(new Uint8Array(bytes), kindOf(placement.at || `${placement.model}.ydr`))[0] || null : null;
      } catch {
        drawable = null;
      }
      drawables.set(key, drawable);
    }
    const drawable = drawables.get(key);
    if (!drawable) continue;
    /* Ткань (полотна у арок, флаги — модели `.yft`) в игре висит и колышется
       не там, где лежит в модели (проверка в игре 10.10.2026: полотно закрыло
       картинку на 3 см перед ним): её грани — отдельно, с запасом. */
    const target = /\.yft$/i.test(String(placement.at || "")) ? clothOut : out;
    for (const triangle of worldTriangles(drawable, placement))
      if (near(triangle.min, triangle.max)) target.push(...triangle.world[0], ...triangle.world[1], ...triangle.world[2]);
  }
  return { solid: Float32Array.from(out), cloth: Float32Array.from(clothOut) };
}

/**
 * Плашки, вынесенные перед деталями стены: у каждой — `clearance` (на
 * сколько метров её вынесли), `position` сдвинута по её нормали. Плашка с
 * `hug` — покраска стены, а не картинка (сторона здания «Покрасить»): она
 * прилегает к стене, как раньше.
 */
export function clearPlates(plates, triangles, options = {}) {
  /* Грани: `{ solid, cloth }` (`nearPlateTriangles`) или один массив. */
  const solid = triangles?.solid || (triangles?.length ? triangles : null);
  const cloth = triangles?.cloth?.length ? triangles.cloth : null;
  if (!solid?.length && !cloth) return plates;
  const margin = options.margin ?? PLATE_CLEARANCE_MARGIN;
  return plates.map((plate) => {
    if (plate.hug) return plate;
    const frame = plateFrame(plate);
    const extra = Math.max(
      solid?.length ? plateClearance(frame, solid, options) : 0,
      /* Ткань — и та, что в модели чуть позади плашки (щелчок пришёлся на само
         полотно): плашка встаёт на запас впереди её места в модели. */
      cloth
        ? plateClearance({ ...frame, point: frame.point.map((value, axis) => value - frame.normal[axis] * CLOTH_SWAY) }, cloth, {
            ...options,
            margin,
            depth: (options.depth ?? PLATE_CLEARANCE_DEPTH) + CLOTH_SWAY,
          })
        : 0,
    );
    if (!extra) return plate;
    return { ...plate, position: plate.position.map((value, axis) => Math.round((value + frame.normal[axis] * extra) * 1000) / 1000), clearance: extra };
  });
}
