/*
 * «Интерьеры» — свои копии вещей под своими именами (второй заход задачи 3
 * ТЗ 10.10.2026).
 *
 * Колонки одной станции со своим обликом — копия архетипа колонки под своим
 * именем (`astral_shops_<станция>_<колонка>`) со своей моделью: штатная
 * модель игры одна на все заправки, и правка её листов легла бы на все
 * станции сразу. Копии архетипов — в постоянных типах набора
 * `astral_shops_local.ytyp` (пакет мест держит их запросом `DLC_ITYP_REQUEST`,
 * как пакеты Rockstar — свои пропы), сущности колонок станции в картах района
 * смотрят на копии.
 *
 * Имена — здесь, одни на установщик (`apps/desktop/src/recolor-shops.js`) и
 * строгую проверку пакета (`scripts/lib/shops-trust-writer.mjs` →
 * `packages/install-engine/shops-trust.js`).
 */

/** Постоянные типы копий набора (имя без расширения). */
export const SHOPS_LOCAL_TYPES = "astral_shops_local";

const clean = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

/** Имя копии колонки станции: `astral_shops_gas1181_m330_pump1c`. */
export const stationPumpCloneName = (stationId, pumpId) => `astral_shops_${clean(stationId)}_${clean(pumpId)}`;

const leaf = (address) => String(address).split("/").pop().toLowerCase();

/*
 * Своя копия вещи помещения (задача 5 ТЗ 11.10.2026): модель со встроенными
 * листами, что стоит и в других местах (полки 24/7 — и в LTD), перекрашивается
 * копией `astral_shops_<помещение>_<модель>`, сущности помещения смотрят на
 * неё. Имя игры — не длиннее 63 знаков: длинное укорачивается хвостом-хешем.
 */
export function interiorCopyName(interiorId, model) {
  const name = `astral_shops_${clean(interiorId)}_${clean(model)}`;
  if (name.length <= 60) return name;
  let hash = 0;
  for (const char of name) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return `${name.slice(0, 51)}_${hash.toString(16).padStart(8, "0")}`;
}

/** Файлы своих копий вещей помещений по описи помещений: имена моделей-копий. */
export function interiorCopyFiles(shops) {
  const files = new Set();
  for (const interior of shops?.interiors || [])
    for (const list of Object.values(interior.surfaces || {}))
      for (const sheet of list) if (sheet.copy) files.add(`${interiorCopyName(interior.id, sheet.copy.model)}.${String(sheet.file).split(".").pop().toLowerCase()}`);
  return [...files].sort();
}

/**
 * Файлы своих копий по описи «снаружи»: `{ overrides, files }` —
 * перекрытия (постоянные типы и карты районов с колонками станций) и копии
 * моделей колонок (потоковый архив).
 */
export function shopsLocalFiles(outside) {
  const overrides = new Set([`${SHOPS_LOCAL_TYPES}.ytyp`]);
  const files = new Set();
  const pumpFiles = new Map((outside?.pumps || []).map((pump) => [pump.model, pump]));
  for (const place of outside?.places || []) {
    for (const pump of place.pumps || []) {
      const spec = pumpFiles.get(pump.model);
      if (!spec) continue;
      files.add(`${stationPumpCloneName(place.id, spec.id)}.${String(spec.file).split(".").pop()}`);
      for (const ref of pump.refs || []) overrides.add(leaf(ref.map));
    }
  }
  return { overrides: [...overrides].sort(), files: [...files].sort() };
}
