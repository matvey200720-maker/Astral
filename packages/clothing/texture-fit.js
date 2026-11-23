/*
 * Ложится ли расцветка на модель (ТЗ владельца 11.11.2026: «текстурка накладывается неправильно, она порватая»).
 *
 * Расцветка вещи — лист с островками развёртки модели. Если автор положил в пакет лист от другой модели («Лонгслив · STEEL MODS»: лист безрукавки на рубашке — половина листа
 * прозрачна, а вещь рисуется чёрно-белыми пятнами) или штатные листы игры на своей модели («Mask oni»), на обложке и в 3D получается «рваная» вещь. Считать такое глазами не из чего,
 * поэтому признаков три, и все — по самим файлам, без рендера:
 *   • дыры: доля закрашенных развёрткой модели пикселей листа, где он прозрачен. ПОДОЗРЕНИЕ, не приговор: у «Лонгслив · STEEL MODS» дыры 45 % и лист от безрукавки, но у крыльев («Killa wings»,
 *     «Wings fairy») дыры 82–100 %, а вещи целые — у кусков без режима прозрачности (`ped`) шейдер альфу листа не читает, лист прозрачен «по замыслу» (перепись 11.11.2026, глазами);
 *   • выбивающийся лист: у вещи несколько расцветок одной раскладки, и одна из них не похожа на остальные по карте краёв («Bebra STEEL»: лист монограммы от другой кепки среди трёх листов этой модели).
 *     Это ПОДОЗРЕНИЕ, не приговор: у «Enfants» чёрная расцветка с зеркальной надписью и у сумки «Balenciaga chips» чёрная с другим рисунком тоже выбились, а вещи целые (перепись 11.11.2026, глазами: 1 из 3).
 *     Выбившийся лист в каталог не отбрасывается сам — он идёт в отчёт, и решает человек (в перекладке — запись в `manual` с доказательством);
 *   • пустой лист: прозрачный целиком (`isEmptyPicture`). Сплошной цвет — не брак: плоская расцветка бывает вещью («Mask oni», «BlacknailsbyCarti»), белое худи, чёрная футболка; такой лист только
 *     помечается (`isBlankPicture`, `isTinyBlank`).
 *
 * Пороги — по переписи 506 карточек каталога (`scripts/clothing-defects-census.mjs`, отчёт `REPORT-H26-clothing-1111.md`). Модуль чистый: модель и картинки приходят параметрами.
 */

/** Сторона сетки, на которой считаются развёртка и картинка. */
export const FIT_GRID = 128;

/**
 * Дыр больше — лист не ложится на модель. «Лонгслив · STEEL MODS»: 45 %. Порог поднят до четверти по переписи: у бронежилета «clxn 95» дыр 12,5 % (место между кусками, обложка целая),
 * у всех целых вещей переписи — ниже.
 */
export const HOLES_MAX = 0.25;

/** Лист из трёх и более расцветок одной раскладки — выбивающимся считается тот, чья карта краёв похожа на остальные меньше этого. */
export const OUTLIER_FIT = 0.15;

/** …и только когда остальные расцветки между собой не меньше этого схожи (иначе раскладка у них разная и судить не по чему). */
export const SIBLING_FIT = 0.4;

/**
 * Закрашенные развёрткой модели места (`FIT_GRID × FIT_GRID`, 1 — есть кусок) и число треугольников. Только непрозрачные куски: у ткани с прозрачностью дыры в листе — штатное дело.
 * Лист повторяется (адресация — wrap, как в игре): координата вне [0, 1) — то же место листа, что её дробная часть. У моделей, где V лежит в [−1, 0] («Рюкзак LA x NPA», `hand_095_u.ydd`:
 * 6786 треугольников, V от −1,00 до −0,00), развёртка раньше не попадала на сетку вовсе — покрытие 0 %, дыры 0, — и признак «дыры под развёрткой» на них молчал (11.11.2026).
 */
export function uvCoverage(drawable, grid = FIT_GRID) {
  const cover = new Uint8Array(grid * grid);
  let triangles = 0;
  for (const mesh of drawable?.meshes || []) {
    if (!mesh.uvs || !mesh.indices || mesh.material?.alphaMode !== "opaque")
      continue;
    const { indices, uvs } = mesh;
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = [uvs[indices[t] * 2] * grid, uvs[indices[t] * 2 + 1] * grid];
      const b = [
        uvs[indices[t + 1] * 2] * grid,
        uvs[indices[t + 1] * 2 + 1] * grid,
      ];
      const c = [
        uvs[indices[t + 2] * 2] * grid,
        uvs[indices[t + 2] * 2 + 1] * grid,
      ];
      const denominator =
        (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (!denominator) continue;
      triangles += 1;
      const minX = Math.floor(Math.min(a[0], b[0], c[0]));
      const maxX = Math.ceil(Math.max(a[0], b[0], c[0]));
      const minY = Math.floor(Math.min(a[1], b[1], c[1]));
      const maxY = Math.ceil(Math.max(a[1], b[1], c[1]));
      /* Кусок шире двух листов — плитка повторов, судить по нему не о чем. */
      if (maxX - minX > 2 * grid || maxY - minY > 2 * grid) continue;
      for (let y = minY; y <= maxY; y += 1)
        for (let x = minX; x <= maxX; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          const l1 =
            ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) /
            denominator;
          const l2 =
            ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) /
            denominator;
          if (l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0)
            cover[
              (((y % grid) + grid) % grid) * grid + (((x % grid) + grid) % grid)
            ] = 1;
        }
    }
  }
  return { cover, triangles };
}

/** Картинка (`{ width, height, rgba }`) на сетке: яркость и альфа каждой клетки. */
export function sampleGrid(picture, grid = FIT_GRID) {
  const { width, height, rgba } = picture;
  const luma = new Float32Array(grid * grid);
  const alpha = new Float32Array(grid * grid);
  for (let y = 0; y < grid; y += 1)
    for (let x = 0; x < grid; x += 1) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / grid));
      const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / grid));
      const at = (sy * width + sx) * 4;
      luma[y * grid + x] =
        0.299 * rgba[at] + 0.587 * rgba[at + 1] + 0.114 * rgba[at + 2];
      alpha[y * grid + x] = rgba[at + 3];
    }
  return { luma, alpha };
}

/** Доля закрашенных развёрткой клеток, где лист прозрачен (альфа < 16); 0 — дыр нет или развёртки нет. */
export function holesShare(sampled, coverage) {
  let inside = 0;
  let holes = 0;
  for (let i = 0; i < sampled.alpha.length; i += 1)
    if (coverage.cover[i]) {
      inside += 1;
      if (sampled.alpha[i] < 16) holes += 1;
    }
  return inside ? holes / inside : 0;
}

/** Карта краёв листа: модуль градиента яркости. */
export function edgeMap(sampled, grid = FIT_GRID) {
  const edge = new Float32Array(grid * grid);
  const { luma } = sampled;
  for (let y = 1; y < grid - 1; y += 1)
    for (let x = 1; x < grid - 1; x += 1) {
      const gx = luma[y * grid + x + 1] - luma[y * grid + x - 1];
      const gy = luma[(y + 1) * grid + x] - luma[(y - 1) * grid + x];
      edge[y * grid + x] = Math.hypot(gx, gy);
    }
  return edge;
}

/** Корреляция двух карт краёв: 1 — раскладка совпала, 0 — связи нет. */
export function correlation(a, b) {
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < a.length; i += 1) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / a.length;
  const meanB = sumB / b.length;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  return varianceA && varianceB
    ? covariance / Math.sqrt(varianceA * varianceB)
    : 0;
}

const median = (values) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

/**
 * Схожесть раскладки каждого листа с остальными листами вещи: медиана корреляции карт краёв. У одного листа сравнивать не с чем — `null`.
 * @param {Array<Float32Array>} edges карты краёв листов
 * @returns {Array<number|null>}
 */
export function siblingFits(edges) {
  return edges.map((own, at) => {
    const others = edges.filter((_, other) => other !== at);
    return others.length
      ? median(others.map((edge) => correlation(own, edge)))
      : null;
  });
}

/**
 * Какие из листов выбиваются из раскладки вещи: три листа и больше, у листа схожесть с остальными ниже `OUTLIER_FIT`, а остальные между собой схожи не ниже `SIBLING_FIT`.
 * @returns {boolean[]} по порядку листов
 */
export function layoutOutliers(edges) {
  const fits = siblingFits(edges);
  if (edges.length < 3) return edges.map(() => false);
  return fits.map((fit, at) => {
    if (fit === null || fit >= OUTLIER_FIT) return false;
    const rest = edges.filter((_, other) => other !== at);
    const pairs = [];
    for (let i = 0; i < rest.length; i += 1)
      for (let j = i + 1; j < rest.length; j += 1)
        pairs.push(correlation(rest[i], rest[j]));
    return (median(pairs) ?? 0) >= SIBLING_FIT;
  });
}

/** Файл листа не больше этого — рисунка в нём быть не может: сплошной цвет 256×256 жмётся в 200–600 байт, а настоящий лист — десятки килобайт. */
export const TINY_TEXTURE_BYTES = 1024;

/**
 * Пустой лист: прозрачный целиком. Сплошной цвет — не пустой: «Mask oni» — две расцветки автора по 392–393 байта (плоские цвета на своей модели), «BlacknailsbyCarti» — чёрный лист в 312 байт;
 * это и есть вещь. Такие листы только помечаются (`isTinyBlank`) — глазами видно, вещь ли это.
 */
export function isEmptyPicture({ width, height, rgba }) {
  if (!width || !height) return true;
  for (let i = 3; i < width * height * 4; i += 4)
    if (rgba[i] >= 16) return false;
  return true;
}

/**
 * Альфа листа — маска свечения, а не прозрачность: у моделей с шейдером `ped_emissive` (светящиеся шапки и полосы проектов RP) в альфе диффуз-листа лежит сила свечения — у несветящихся
 * расцветок вещи это одно число на весь лист (у `gta5rp_skins7f/p_head_012` — 3 из 255), у светящихся — пятна 255. В игре и на кадре такой лист рисуется непрозрачным, а ворота по голой альфе
 * считали семь расцветок из восьми «пустыми».
 */
export function alphaIsEmissionMask(drawable) {
  const meshes = drawable?.meshes ?? [];
  const opaque = (mesh) => (mesh.material?.alphaMode ?? "opaque") === "opaque";
  /* Маска — только у `ped_emissive` с непрозрачным режимом. Остальное семейство светящихся шейдеров (`emissive_alpha`, `glass_emissive_alpha`, `emissive_clip`, неоновое тату) — альфа настоящая прозрачность.
     Лист один на все меши вещи, поэтому если хоть у одного меша альфа — прозрачность, лист судится по альфе как раньше. */
  return (
    meshes.some(
      (mesh) => mesh.material?.shader === "ped_emissive" && opaque(mesh),
    ) && meshes.every(opaque)
  );
}

/**
 * Пуст ли лист. Прозрачный целиком — пуст, когда альфа что-то значит; когда это маска свечения (`alphaCounts: false`), лист не пуст: сплошной цвет — не брак (плоская расцветка бывает вещью), а прозрачность
 * в маске ничего не говорит. Лист без размера пуст всегда.
 */
export function isEmptySheet(picture, { alphaCounts = true } = {}) {
  if (!picture.width || !picture.height) return true;
  return alphaCounts && isEmptyPicture(picture);
}

/** Копия листа с непрозрачной альфой: образец цвета и сверка расцветок берут пиксели с альфой ≥ 128, а у листа с маской свечения она может быть 3. */
export function opaqueCopy({ width, height, rgba }) {
  const copy = new rgba.constructor(rgba);
  for (let i = 3; i < copy.length; i += 4) copy[i] = 255;
  return { width, height, rgba: copy };
}

/**
 * Мера одного листа расцветки для ворот: сетка, дыры под развёрткой, пустота и сам лист. У модели с маской свечения (`emission`, `alphaIsEmissionMask`) альфа — сила свечения: дыр по ней нет, лист не пуст,
 * а дальше (образец цвета, кадр, 3D) идёт копия с непрозрачной альфой. `source` — лист как в файле: по нему сверяются расцветки (две расцветки с одним цветом и разной маской свечения — разные).
 * @returns {{ picture: object, source: object, sampled: object, measure: { empty: boolean, holes: number } }}
 */
export function measureSheet(
  picture,
  { coverage = null, emission = false } = {},
) {
  const sampled = sampleGrid(picture);
  const holes = coverage && !emission ? holesShare(sampled, coverage) : 0;
  return {
    picture: emission ? opaqueCopy(picture) : picture,
    source: picture,
    sampled,
    measure: {
      empty: isEmptySheet(picture, { alphaCounts: !emission }),
      holes,
    },
  };
}

/** Сплошной цвет в крошечном файле при настоящих размерах листа (≥ 64×64): плоская расцветка без рисунка. Пометка для отчёта, не отказ. */
export function isTinyBlank(picture, { bytes = Infinity } = {}) {
  return (
    bytes <= TINY_TEXTURE_BYTES &&
    picture.width * picture.height >= 64 * 64 &&
    isBlankPicture(picture)
  );
}

/** Сплошная заливка вместо ткани: почти все пиксели — в пределах 6 уровней от среднего цвета. */
export function isBlankPicture({ width, height, rgba }) {
  const count = width * height;
  if (!count) return true;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < count; i += 1) {
    r += rgba[i * 4];
    g += rgba[i * 4 + 1];
    b += rgba[i * 4 + 2];
  }
  r /= count;
  g /= count;
  b /= count;
  let near = 0;
  for (let i = 0; i < count; i += 1)
    if (
      Math.abs(rgba[i * 4] - r) < 7 &&
      Math.abs(rgba[i * 4 + 1] - g) < 7 &&
      Math.abs(rgba[i * 4 + 2] - b) < 7
    )
      near += 1;
  return near / count > 0.985;
}
