/*
 * Разметка выделения с сервера, рантайм (ТЗ 26.10.2026, раздел D): что в кадре — один предмет, класс стен комнаты, все планшеты.
 *
 * Формат файла (`.selmap`), его XML-исходник и генератор — у `@modovik/climb-contract/selection` (Helper 2). Здесь — то, что нужно
 * кадру от готовой разметки: из попадания луча узнать, какой элемент под курсором, и из элемента собрать описание подсветки.
 * Разметка — объект с `elementOfHit(hit)` → номер элемента или -1, `targetOf(i)` / `targetOfMany(list)` → цель подсветки и
 * `ofKind(kind)` → номера элементов рода; весь остальной вид файла отсюда не виден.
 *
 *   элемент   { id, type: "surface" | "content" | "prop", kind, room }
 *             surface — класс материала в закрытой комнате: щелчок берёт весь класс; content и prop — всегда один предмет;
 *   цель      { entities: Int32Array, sheet: string | null, group: string | null, runs: Int32Array }  (targetOf)
 *             { sets: [{ entities, sheet, group }], runs }                                              (targetOfMany)
 *
 * Попадание луча кадра: `entity` (сцена версии 2), лист `info.name` и группа `info.group`, номер сетки `meshIndex` и номер
 * треугольника `faceIndex` (скрытые поля попадания, их ставит `orbit-stage.js`). Разметки нет или она не назвала элемент —
 * `-1`, и кадр живёт прежним путём: сущность и лист, а у сцены без номеров — остров сетки (`picked-piece.js`).
 *
 * Подсветка берёт готовые числа: сущности — `Set`, диапазоны — один кусок геометрии (`island-piece.js: rangeProxy`); сетки
 * сцены не пересчитываются, сцена не обходится целиком больше, чем уже обходится подсветкой. Описание цели собирается один раз
 * на набор элементов и держится в `WeakMap` по разметке.
 */

/* Сеток одной цели не больше стольких (как у куска `picked-piece.js`): у класса стен их много, но это одна цель. */
const MARKUP_LIMIT = 900;

/* Лист — `name` материала арены; у завода и ангара записи материалов без имени: `texture` и `sheet` (так же читает выпечка разметки). */
export const sheetOf = (info) => (info ? String(info.name || info.texture || info.sheet || "").toLowerCase() : "");

/** Попадание кадра в виде, как его ждёт разметка: `{ entity?, sheet?, group?, mesh?, face? }`. */
export function markupHitOf(hit) {
  if (!hit) return null;
  const key = {};
  if (Number.isInteger(hit.entity)) key.entity = hit.entity;
  const sheet = sheetOf(hit.info);
  if (sheet) key.sheet = sheet;
  if (hit.info?.group) key.group = String(hit.info.group);
  if (Number.isInteger(hit.meshIndex)) key.mesh = hit.meshIndex;
  if (Number.isInteger(hit.faceIndex)) key.face = hit.faceIndex;
  return key;
}

/** Номер элемента разметки под попаданием или -1 (нет разметки, нет ключа, разметка не назвала). */
export function markupElementOf(markup, hit) {
  if (!markup?.elementOfHit) return -1;
  const key = markupHitOf(hit);
  if (!key || (key.entity === undefined && (key.mesh === undefined || key.face === undefined))) return -1;
  const found = markup.elementOfHit(key);
  return Number.isInteger(found) && found >= 0 ? found : -1;
}

const specCache = new WeakMap();


/** Условие по записи материала и сетке: сущность из набора (и лист, и группа, если разметка их назвала). */
function whereOf(sets) {
  const prepared = sets
    .filter((item) => item.entities?.length)
    .map((item) => ({ entities: item.entities instanceof Set ? item.entities : new Set(item.entities), sheet: item.sheet || "", group: item.group || "" }));
  if (!prepared.length) return null;
  return (info, mesh) => {
    const entity = mesh.userData.entity;
    for (const item of prepared) {
      if (!item.entities.has(entity)) continue;
      if (item.sheet && sheetOf(info) !== item.sheet) continue;
      if (item.group && info?.group !== item.group) continue;
      return true;
    }
    return false;
  };
}

/**
 * Описание подсветки для набора элементов `list` (номера): сущности — условием `where`, диапазоны треугольников — `runs`. Кусок
 * неделимый и стоячий (`steady`, `logical`), как у выбранного предмета. `null` — разметка не дала цели.
 */
export function markupSpec(markup, list, name = null) {
  if (!markup || !list?.length) return null;
  let perMarkup = specCache.get(markup);
  if (!perMarkup) specCache.set(markup, (perMarkup = new Map()));
  const key = name || (list.length === 1 ? String(list[0]) : Array.from(list).join(","));
  if (perMarkup.has(key)) return perMarkup.get(key);
  const target = list.length === 1 && markup.targetOf ? markup.targetOf(list[0]) : markup.targetOfMany?.(list);
  let spec = null;
  if (target) {
    const sets = target.sets || [{ entities: target.entities, sheet: target.sheet, group: target.group }];
    const where = whereOf(sets);
    const runs = target.runs?.length ? target.runs : null;
    if (where || runs) {
      spec = { logical: true, steady: true, limit: MARKUP_LIMIT, ...(where ? { where } : {}), ...(runs ? { runs, runsKey: `m:${key}` } : {}) };
    }
  }
  perMarkup.set(key, spec);
  return spec;
}

/** Описание подсветки «все такие»: все элементы рода `kind` (кнопка «Выбрать все такие», панель «Предметы»). */
export function markupKindSpec(markup, kind) {
  const list = markup?.ofKind?.(kind);
  return list?.length ? markupSpec(markup, list, `kind:${kind}`) : null;
}
