/*
 * Область листа, которую занимает выбранная поверхность (ТЗ 18.10.2026,
 * Session 1, задача 3): студия открывается не на весь лист текстуры, а на то,
 * что человек выбрал — «Стены», «Отделку и металл», пол, вывеску. Лист у
 * здания общий для многих мест, а развёртка выбранной поверхности занимает на
 * нём только свои полосы и острова; их прямоугольник и есть то, что студия
 * показывает и что правит кисть.
 *
 * Считается по развёртке (`uvs`) сеток сцены, чьи материалы отобрала
 * поверхность: каждый треугольник отмечает занятые доли листа по каждой оси
 * (ось в 128 долях), область — рамка занятых долей с запасом в одну. Развёртка
 * плиткой (длинная стена: u идёт от 0 до 5) занимает ось целиком — как и
 * треугольник, что перешагнул границу листа. Если рамка почти равна всему листу,
 * область не нужна: показывать нечего, кроме листа.
 */

/** Долей листа по оси: точность рамки около 0,8 %. */
export const REGION_BINS = 128;
/** Рамка больше этой доли листа — «весь лист»: сужать нечего. */
export const REGION_WHOLE_SHARE = 0.9;

function markAxis(bins, low, high) {
  const span = high - low;
  if (span >= 1) {
    bins.fill(1);
    return;
  }
  const start = low - Math.floor(low);
  const end = start + span;
  const last = REGION_BINS - 1;
  const from = Math.min(last, Math.floor(start * REGION_BINS));
  if (end <= 1) {
    for (let at = from; at <= Math.min(last, Math.floor(end * REGION_BINS)); at += 1) bins[at] = 1;
    return;
  }
  /* Перешагнул границу листа: занят и конец, и начало — рамка целиком. */
  bins.fill(1);
}

function bounds(bins) {
  let first = -1;
  let last = -1;
  for (let at = 0; at < bins.length; at += 1)
    if (bins[at]) {
      if (first < 0) first = at;
      last = at;
    }
  if (first < 0) return null;
  const from = Math.max(0, first - 1);
  const to = Math.min(bins.length, last + 2);
  return [from / bins.length, to / bins.length];
}

/**
 * Рамка развёртки сеток `meshes` (`{ uvs, indices }` сцены) в долях листа:
 * `{ uv: [u0, v0, u1, v1], share }` (`v` — сверху вниз, как строки картинки;
 * `share` — доля листа) или `null`, если у сеток нет развёртки.
 */
export function uvRegionOf(meshes) {
  const across = new Uint8Array(REGION_BINS);
  const down = new Uint8Array(REGION_BINS);
  let triangles = 0;
  for (const mesh of meshes || []) {
    const { uvs, indices } = mesh || {};
    if (!uvs || !indices) continue;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const a = indices[at] * 2;
      const b = indices[at + 1] * 2;
      const c = indices[at + 2] * 2;
      const u0 = Math.min(uvs[a], uvs[b], uvs[c]);
      const u1 = Math.max(uvs[a], uvs[b], uvs[c]);
      const v0 = Math.min(uvs[a + 1], uvs[b + 1], uvs[c + 1]);
      const v1 = Math.max(uvs[a + 1], uvs[b + 1], uvs[c + 1]);
      if (![u0, u1, v0, v1].every(Number.isFinite)) continue;
      markAxis(across, u0, u1);
      markAxis(down, v0, v1);
      triangles += 1;
    }
  }
  if (!triangles) return null;
  const u = bounds(across);
  const v = bounds(down);
  if (!u || !v) return null;
  return { uv: [u[0], v[0], u[1], v[1]], share: (u[1] - u[0]) * (v[1] - v[0]) };
}

/**
 * Область для студии: `[u0, v0, u1, v1]` или `null`, когда поверхность занимает
 * почти весь лист (или развёртки нет) и сужать вид не к чему.
 */
export function surfaceRegion(meshes) {
  const found = uvRegionOf(meshes);
  return found && found.share < REGION_WHOLE_SHARE ? found.uv : null;
}

/** Рамка в долях листа → прямоугольник холста `width × height`, пиксели (целые, внутри холста). */
export function regionRect(uv, width, height) {
  if (!Array.isArray(uv) || uv.length !== 4 || !(width > 0) || !(height > 0)) return null;
  const x = Math.max(0, Math.floor(uv[0] * width));
  const y = Math.max(0, Math.floor(uv[1] * height));
  const right = Math.min(width, Math.ceil(uv[2] * width));
  const bottom = Math.min(height, Math.ceil(uv[3] * height));
  if (right - x < 1 || bottom - y < 1) return null;
  return { x, y, width: right - x, height: bottom - y };
}
