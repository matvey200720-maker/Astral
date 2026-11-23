/*
 * Правка таблицы травы в `procedural.meta`.
 *
 * Разбор и сборка файла берутся у раздела оптимизации: тот же файл, тот же
 * строгий парсер без DTD, та же побайтовая сверка на живой сборке. Второй
 * разборщик для одного файла разошёлся бы с первым в первый же месяц — а
 * расходиться им негде: `procObjInfos` правит оптимизация, `plantInfos` — эта
 * мастерская, и дерево между ними общее.
 *
 * ЧТО ПРАВИТСЯ И ЧТО НЕТ
 *
 * Только наземная трава. Записи с флагом `PROCPLANT_UNDERWATER` — водоросли и
 * кораллы морского дна (на живой сборке их 50 из 319); поднимать их вместе с
 * газоном не просил никто, а «трава стала выше» на дне залива выглядит
 * поломкой. Пустая запись `_EMPTY_PLANT_` — заглушка таблицы, у неё нет ни
 * модели, ни смысла.
 *
 * Потолки полей взяты не с потолка: это края ванильного разброса живой сборки
 * с запасом. Плотность там доходит до 4.5, рост — до 1.0, наклон под ветром —
 * до 2.0, частота дрожи — до 1.5. Множитель в четыре конца уводит любое из них
 * за край, и без потолка трава либо съедает кадр, либо ложится плашмя.
 */

import {
  childElement,
  numericField,
  parseProceduralMeta,
  serializeProceduralMeta,
  fieldValue,
} from "@modovik/optimizer/procedural.js";

/** Верхние пределы полей записи. Ниже нуля игра не понимает ни одного из них. */
const FIELD_LIMITS = Object.freeze({
  Density: 8,
  DensityRange: 4,
  ScaleZ: 4,
  ScaleVariationXY: 1,
  ScaleVariationZ: 1,
  WindBendScale: 6,
  MicroMovementsFreqH: 4,
  MicroMovementsFreqV: 4,
});

const EMPTY_PLANT_TAG = "_EMPTY_PLANT_";

/**
 * Какие поля записи двигает какая правка.
 *
 * Плотность и её разброс едут вместе, иначе «вдвое гуще» превратило бы
 * разнобой в ровный ковёр; так же связаны обе оси разброса размера и обе
 * частоты дрожи — горизонтальная и вертикальная.
 */
const EDIT_FIELDS = Object.freeze({
  density: ["Density", "DensityRange"],
  height: ["ScaleZ"],
  spread: ["ScaleVariationXY", "ScaleVariationZ"],
  windBend: ["WindBendScale"],
  windSpeed: ["MicroMovementsFreqH", "MicroMovementsFreqV"],
});

/**
 * Пишет число в том же виде, в каком его пишет игра: шесть знаков после
 * запятой. Возвращает `false`, если поля нет или число не сдвинулось, — по
 * этому и считается, сколько записей в самом деле тронуто.
 */
function multiplyField(item, name, factor) {
  const child = childElement(item, name);
  if (!child) return false;
  const current = numericField(item, name);
  if (current === null) return false;
  const limit = FIELD_LIMITS[name] ?? Number.POSITIVE_INFINITY;
  const written = Math.min(Math.max(current * factor, 0), limit).toFixed(6);
  if (child.attributes.value === undefined) return false;
  if (child.attributes.value === written) return false;
  child.attributes.value = written;
  return true;
}

const isUnderwater = (item) =>
  /PROCPLANT_UNDERWATER/.test(String(fieldValue(item, "Flags") || ""));

const isEmptyPlant = (item) =>
  String(fieldValue(item, "Tag") || "").trim() === EMPTY_PLANT_TAG;

/**
 * Накладывает правки на текст `procedural.meta` и возвращает новый текст со
 * счётом тронутых записей.
 *
 * Пустой набор правок сюда не приходит: разреженность обеспечена выше
 * (`vegetationPlantEdits`), и пустым он означает «человек ничего не двинул».
 * А вот нулевой счёт при непустых правках означает другое — таблица есть, но
 * ни одно поле не сдвинулось, — и вызывающий обязан сказать об этом вслух, а
 * не поставить патч-пустышку.
 */
export function applyVegetationPlantEdits(xml, edits) {
  const document = parseProceduralMeta(xml);
  const section = childElement(document, "plantInfos");
  if (!section)
    throw new Error(
      "В procedural.meta нет таблицы plantInfos — это не файл растительности игры.",
    );

  const counts = { plants: 0, underwater: 0, skipped: 0, fields: 0 };
  for (const item of section.children) {
    if (!item || item.name !== "Item") continue;
    if (isUnderwater(item)) {
      counts.underwater += 1;
      continue;
    }
    if (isEmptyPlant(item)) {
      counts.skipped += 1;
      continue;
    }

    let touched = 0;
    for (const [edit, fields] of Object.entries(EDIT_FIELDS)) {
      const factor = edits?.[edit];
      if (factor === undefined) continue;
      for (const field of fields)
        if (multiplyField(item, field, factor)) touched += 1;
    }

    if (touched) {
      counts.plants += 1;
      counts.fields += touched;
    }
  }

  return { xml: serializeProceduralMeta(document), counts };
}
