import { currentQuality } from "./quality-profile.js";

/*
 * Размер листа места мира по площади материала и по близости к камере (общее у «Зон» и «Зон каптов»: `zones-editor/zones-world.js`,
 * `capt-zones-editor/CaptZonesStage.jsx`). `mapSize` материала в `look` кадра — предел стороны листа: лист игры меньшего размера остаётся своим.
 */

/* Ступени листа по поверхности материала, м²: сторона листа. */
export const SHEET_TIERS = Object.freeze([
  [150, 1024],
  [25, 512],
  [3, 256],
  [0, 128],
]);
/* На плане зоны камера стоит вплотную, а листов мало: ступени выше. */
const PLAN_SHEET_TIERS = Object.freeze([
  [8, 1024],
  [0, 512],
]);
/* Сколько видеопамяти кадр может занять листами, байт (с мипами). Больше — самые мелкие из крупных ступенью ниже. */
export const SHEET_BUDGET = 900 * 1024 * 1024;
const sheetBytes = (size) => size * size * 4 * (4 / 3);

/**
 * Сколько видеопамяти занимает лист сцены сейчас: у сжатого листа (блоки BCn, `sheet-texture.js: applySheet`) — его настоящие байты (`userData.sheet.bytes`),
 * у обычной текстуры с картинкой — RGBA с мипами (та же мера, что у `placeSheetSizes`), у пустой — 0. Планирование размеров по-прежнему считает худший случай
 * (RGBA): формат листа до ответа читателя неизвестен, а запрошенные ступени от формата не зависят.
 */
export function sheetVideoBytes(texture) {
  const sheet = texture?.userData?.sheet;
  if (texture?.isCompressedTexture && sheet && Number.isFinite(sheet.bytes)) return sheet.bytes;
  const image = texture?.image;
  return image && image.width > 0 && image.height > 0 ? Math.round(image.width * image.height * 4 * (4 / 3)) : 0;
}
const sheetsOf = (info) => (info.terrain ? (info.terrain.layers || []).filter((slot) => slot !== null && slot !== undefined).length + (info.terrain.mask !== null && info.terrain.mask !== undefined ? 1 : 0) : 1);

/** Размер листа у материала сцены плана зоны: как `placeSheetSizes`, ступени свои. `near` — `sceneDistances`. */
export const planSheetSizes = (materials, near = null) => placeSheetSizes(materials, SHEET_BUDGET, PLAN_SHEET_TIERS, near);

/*
 * «Один в один» вблизи (владелец 10.11.2026: «текстурки погрызаны»). Ступени по площади (`SHEET_TIERS`) мерят суммарную площадь материала на всю
 * сцену, а не то, как близко он к камере: гидрант, урна, мусор и фасадные атласы стояли в 128…512 px при настоящем листе 512…2048 и вблизи
 * (у зоны, 4 м) выглядели «погрызенными» (замер: 44 % материалов ужато, у мусора ×4, у атласов домов ×2). Теперь то, что рядом с точкой, откуда
 * смотрит кадр (`near`: метры до материала), получает лист не меньше `NEAR_FLOOR` (большие поверхности — до `NEAR_CAP`), у среднего удаления
 * — не меньше 512; сам лист не растягивается (это предел стороны, а не размер: меньший лист игры остаётся своим). В бюджет видеопамяти всё
 * по-прежнему входит, но вниз идут сперва дальние (потом мелкие): ближнее не теряет ничего, пока есть чем пожертвовать вдали.
 */
export const NEAR_FULL = 40;
export const NEAR_MID = 120;
export const NEAR_FLOOR = 1024;
export const NEAR_CAP = 2048;
const BIG_SURFACE = 150;

/*
 * Потолок стороны листа по профилю качества (решение ведущей 14.11.2026): на `low` (встроенные и программные карты) ступень 2048 не выдаётся — потолок 1024, что всё
 * равно лучше прежних 512 и не раздувает слабую карту (лист 2048 с мипами — 21 МиБ против 5,3 у 1024); `medium` и `high` — 2048 под `SHEET_BUDGET`. Сам бюджет от профиля не зависит.
 */
export const SHEET_SIDE_CAPS = Object.freeze({ low: 1024, medium: NEAR_CAP, high: NEAR_CAP });
export const sheetSideCap = (level = currentQuality()) => SHEET_SIDE_CAPS[level] ?? NEAR_CAP;

/** Метры от точки (оси сцены) до ближайшей сетки каждого материала: `Map(номер материала → метры)`. Сетки без коробки в счёт не идут. */
export function sceneDistances(asset, point) {
  const out = new Map();
  if (!Array.isArray(point) || point.length < 2 || !asset?.meshes) return out;
  for (const mesh of asset.meshes) {
    const box = mesh.bounds;
    if (!box || box.length < 6) continue;
    const dx = Math.max(box[0] - point[0], 0, point[0] - box[3]);
    const dy = Math.max(box[1] - point[1], 0, point[1] - box[4]);
    const dz = point.length > 2 ? Math.max(box[2] - point[2], 0, point[2] - box[5]) : 0;
    const distance = Math.hypot(dx, dy, dz);
    const known = out.get(mesh.material);
    if (known === undefined || distance < known) out.set(mesh.material, distance);
  }
  return out;
}

/** Размер листа у материалов сцены места: `Map(номер материала → сторона)`. Материалы зон и воды листов не просят. */
export function placeSheetSizes(materials, budget = SHEET_BUDGET, tiers = SHEET_TIERS, near = null, maxSide = sheetSideCap()) {
  /* Самая крупная сторона, что здесь выдаётся: `NEAR_CAP`, а на слабой карте — ниже (`SHEET_SIDE_CAPS`). */
  const top = Math.min(NEAR_CAP, maxSide);
  const items = [];
  materials.forEach((info, index) => {
    if (typeof info.area !== "number") return;
    let size = Math.min(top, tiers.find(([area]) => info.area >= area)[1]);
    const distance = near?.get(index);
    if (Number.isFinite(distance)) {
      if (distance <= NEAR_FULL) size = Math.min(top, Math.max(size, info.area >= BIG_SURFACE ? top : Math.min(top, NEAR_FLOOR)));
      else if (distance <= NEAR_MID) size = Math.min(top, Math.max(size, 512));
    }
    items.push({ index, area: info.area, size, sheets: sheetsOf(info), distance: Number.isFinite(distance) ? distance : null });
  });
  let total = items.reduce((sum, item) => sum + sheetBytes(item.size) * item.sheets, 0);
  /* Не влезло — сперва вниз идут дальние (если известно, откуда смотрит кадр), потом самые мелкие поверхности самой верхней ступени. */
  items.sort((a, b) => (near ? (b.distance ?? 0) - (a.distance ?? 0) : 0) || a.area - b.area);
  /* Известно, откуда смотрит кадр — вниз идут по поясам: дальние, потом средние, ближние последними; внутри пояса — как прежде, от верхней ступени. */
  const belts = near ? [(item) => !(item.distance <= NEAR_MID), (item) => item.distance > NEAR_FULL && item.distance <= NEAR_MID, (item) => item.distance <= NEAR_FULL] : [() => true];
  for (const inBelt of belts) {
    for (const tier of [2048, 1024, 512, 256]) {
      for (const item of items) {
        if (total <= budget) break;
        if (item.size !== tier || !inBelt(item)) continue;
        total -= (sheetBytes(tier) - sheetBytes(tier / 2)) * item.sheets;
        item.size = tier / 2;
      }
    }
  }
  return new Map(items.map((item) => [item.index, item.size]));
}

/** Суммарная площадь материала в сцене, м² (по треугольникам, как её считает сборка места): для сцен, где `info.area` не записана (выпеченные куски местности). */
export function materialAreas(asset) {
  const out = new Map();
  for (const mesh of asset?.meshes || []) {
    /* Копия модели (сцена версии 3): площадь одна на все копии, вершины копии не разворачиваются. */
    if (typeof mesh.area === "number" && mesh.instance) {
      out.set(mesh.material, (out.get(mesh.material) || 0) + mesh.area);
      continue;
    }
    const { positions, indices } = mesh;
    let area = 0;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const a = indices[at] * 3;
      const b = indices[at + 1] * 3;
      const c = indices[at + 2] * 3;
      const ux = positions[b] - positions[a];
      const uy = positions[b + 1] - positions[a + 1];
      const uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a];
      const vy = positions[c + 1] - positions[a + 1];
      const vz = positions[c + 2] - positions[a + 2];
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    out.set(mesh.material, (out.get(mesh.material) || 0) + area);
  }
  return out;
}

/** Размеры листов сцены, где площадь не записана в материалах: площади считаются по сеткам, остальное — `placeSheetSizes`. */
export function sceneSheetSizes(asset, point = null) {
  const areas = materialAreas(asset);
  const materials = (asset?.materials || []).map((info, index) => (typeof info?.area === "number" ? info : { ...info, ...(areas.has(index) ? { area: areas.get(index) } : {}) }));
  return placeSheetSizes(materials, undefined, undefined, point ? sceneDistances(asset, point) : null);
}
