/*
 * Растительность: граница доверия между окном редактора и архивами игры.
 *
 * Окно присылает проект целиком, и здесь он разбирается заново — ровно как у
 * воды и неба: битое или чужое значение обязано упасть на границе процесса, а
 * не превратиться в правку файла игрока. Пределы записаны второй раз намеренно
 * и не импортируются из окна: main-процесс не читает код рендерера, а рендерер
 * — этот. Их совпадение закреплено тестом, а не импортом.
 *
 * ЧТО В ИГРЕ ЕСТЬ НА САМОМ ДЕЛЕ
 *
 * Трава GTA V живёт не моделями, а таблицей `plantInfos` в
 * `common/data/materials/procedural.meta`: на живой сборке это 319 записей,
 * из них 269 наземных (остальные — водоросли с флагом
 * `PROCPLANT_UNDERWATER`). Каждая запись — один вид травы на одном типе
 * поверхности, и её поля один в один ложатся на ползунки редактора:
 *
 *   • grass.density  → Density, DensityRange      (пучков на метр)
 *   • grass.height   → ScaleZ                     (рост)
 *   • grass.spread   → ScaleVariationXY/Z         (разнобой)
 *   • wind.strength  → WindBendScale              (наклон под ветром)
 *   • wind.speed     → MicroMovementsFreqH/V      (частота дрожи)
 *
 * ПОЧЕМУ МНОЖИТЕЛЬ, А НЕ ЧИСЛО
 *
 * У 269 записей числа РАЗНЫЕ: густой газон Урбана, редкая метёлка дюн, кусты
 * склонов. Записать всем одну плотность значило бы стереть эту разницу и
 * получить один и тот же ковёр от пустыни до леса — ровно та ошибка, из-за
 * которой оптика воды тоже множит суточную кривую, а не затирает её. Поэтому
 * ползунок едет множителем, и мир остаётся разным.
 *
 * ОТ ЧЕГО СЧИТАЕТСЯ МНОЖИТЕЛЬ
 *
 * От штатных чисел ВЫБРАННОГО ПОКРОВА, а не от чисел газона. Покров в окне —
 * это смена растения, а не правка: степная метёлка открывается на шестидесяти
 * двух сантиметрах не потому, что человек её туда поставил. Считать множитель
 * от газона значило бы сделать всю траву игры втрое выше за один щелчок по
 * слову «Степь» — а этого никто не просил. От покровной базы множитель
 * означает то же, что видно в окне: сдвинул ползунок на четверть вверх —
 * трава на четверть выше, и луг с пустыней по-прежнему разные.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ
 *
 * Покров, цвет травы, разброс цвета и дальность в игру не уезжают. Покров —
 * это модели и текстуры внутри архивов, их подменой занимается не эта правка.
 * Цвет у каждой из 269 записей свой (`Color`, `GroundColor`), и один цвет на
 * всех сделал бы пустыню зелёной, а лес — жёлтым. Дальности в записи нет
 * вовсе: трава гаснет по флагам LOD и настройке `GrassQuality`, а не по
 * метрам, и назвать их «дальностью в метрах» значило бы соврать в подписи.
 * Все четыре величины остаются в окне, и редактор говорит об этом вслух.
 */

/** Куда патч ложится в архиве игрока. */
export const VEGETATION_ARCHIVE_ENTRY =
  "update:/common/data/materials/procedural.meta";

/**
 * Откуда читается база. Сначала override в `update.rpf` — на живой сборке
 * Legacy файл там есть и ванильный, и переписанный чужим модом; ванильный
 * `common.rpf` берётся, только если в update записи не нашлось.
 */
export const VEGETATION_BASE_ENTRIES = Object.freeze([
  VEGETATION_ARCHIVE_ENTRY,
  "common:/data/materials/procedural.meta",
]);

/** Файл ставится тем же именем в payload патча. */
export const VEGETATION_PAYLOAD_FILE = "procedural.meta";

/*
 * Штатные числа покровов — база множителя. Проект, не ушедший от них, не
 * правит `procedural.meta` вовсе. Совпадение с таблицей окна
 * (`VEGETATION_COVERS`) закреплено тестом `tests/vegetation-plants.test.js`:
 * разойдись эти два списка — и ползунок, стоящий на месте, начал бы двигать
 * траву игры.
 */
export const VEGETATION_COVER_DEFAULTS = Object.freeze({
  steppe: Object.freeze({ height: 62, density: 10, spread: 55 }),
  lawn: Object.freeze({ height: 17, density: 30, spread: 22 }),
  scrub: Object.freeze({ height: 42, density: 8, spread: 70 }),
  pine: Object.freeze({ height: 34, density: 12, spread: 62 }),
});

export const VEGETATION_DEFAULT_COVER = "lawn";

/** Ветер один на все покровы: он свойство погоды, а не растения. */
export const VEGETATION_DEFAULT_WIND = Object.freeze({
  strength: 30,
  speed: 60,
});

const coverBase = (kind) =>
  VEGETATION_COVER_DEFAULTS[kind] ||
  VEGETATION_COVER_DEFAULTS[VEGETATION_DEFAULT_COVER];

/* Пределы — копия контракта окна (`vegetation-model.js`), проверяемая тестом. */
const RANGES = Object.freeze({
  density: { min: 0, max: 60, step: 1 },
  height: { min: 5, max: 150, step: 1 },
  spread: { min: 0, max: 100, step: 1 },
  strength: { min: 0, max: 100, step: 1 },
  speed: { min: 10, max: 200, step: 5 },
});

const clampTo = (range, value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const held = Math.min(Math.max(numeric, range.min), range.max);
  return Number((Math.round(held / range.step) * range.step).toFixed(4));
};

/** Проект растительности, приведённый к пределам игры. Чужой файл — здесь же. */
export function boundVegetationProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Проект растительности обязателен.");
  const grass = input.grass || {};
  const wind = input.wind || {};
  const kind = VEGETATION_COVER_DEFAULTS[input.cover?.kind]
    ? input.cover.kind
    : VEGETATION_DEFAULT_COVER;
  const base = coverBase(kind);
  return {
    name:
      String(input.name ?? "Растительность").slice(0, 80) || "Растительность",
    cover: { kind },
    grass: {
      density: clampTo(RANGES.density, grass.density, base.density),
      height: clampTo(RANGES.height, grass.height, base.height),
      spread: clampTo(RANGES.spread, grass.spread, base.spread),
    },
    wind: {
      strength: clampTo(
        RANGES.strength,
        wind.strength,
        VEGETATION_DEFAULT_WIND.strength,
      ),
      speed: clampTo(RANGES.speed, wind.speed, VEGETATION_DEFAULT_WIND.speed),
    },
  };
}

const ratio = (value, base) => Number((value / base).toFixed(4));

/**
 * Что человек в самом деле двинул.
 *
 * Поле, оставшееся штатным для своего покрова, в правку не попадает:
 * множитель «ровно один» стоил бы перезаписи всех 269 записей ради тех же
 * чисел, и первая же чужая правка растительности была бы стёрта без повода.
 */
export function vegetationPlantEdits(project) {
  const value = boundVegetationProject(project);
  const base = coverBase(value.cover.kind);
  const edits = {};
  if (value.grass.density !== base.density)
    edits.density = ratio(value.grass.density, base.density);
  if (value.grass.height !== base.height)
    edits.height = ratio(value.grass.height, base.height);
  if (value.grass.spread !== base.spread)
    edits.spread = ratio(value.grass.spread, base.spread);
  if (value.wind.strength !== VEGETATION_DEFAULT_WIND.strength)
    edits.windBend = ratio(
      value.wind.strength,
      VEGETATION_DEFAULT_WIND.strength,
    );
  if (value.wind.speed !== VEGETATION_DEFAULT_WIND.speed)
    edits.windSpeed = ratio(value.wind.speed, VEGETATION_DEFAULT_WIND.speed);
  return edits;
}

/**
 * Манифест патча — те же поля, что у воды и неба, чтобы `install-rpf-patch`
 * не знал про растительность ничего.
 *
 * Действие Import, а не Replace: Replace по отсутствующей записи инжектор
 * молча пропускает, и на сборке без override растительности мод «встал» бы,
 * не появившись в игре.
 */
export function vegetationPatchManifest({ name, files }) {
  return {
    ReduxName: name || "Astral vegetation",
    ParsedAt: new Date().toISOString(),
    TotalPatchSize: files.reduce((total, file) => total + file.size, 0),
    Actions: files.map((file) => ({
      Type: "Import",
      TargetPath: file.target,
      SourcePath: `payload/${file.file}`,
      Size: file.size,
      Sha256: file.sha256,
      IsWholeReplaceNestedRpf: false,
    })),
  };
}
