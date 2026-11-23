/*
 * Вода: граница доверия между окном редактора и архивами игры.
 *
 * Окно присылает проект целиком, и здесь он разбирается заново — ровно как у
 * неба: битое или чужое значение обязано упасть на границе процесса, а не
 * превратиться в правку файла игрока. Пределы записаны второй раз намеренно и
 * не импортируются из окна: main-процесс не читает код рендерера, а рендерер —
 * этот. Их совпадение закреплено тестом, а не импортом.
 *
 * Что уезжает в игру — ровно то, что редактор обещает в своих подписях:
 *
 *   • surface.amplitude / direction / dampening / level → квады `water.xml`
 *     (правит `quads.js`, только сдвинутые человеком поля);
 *   • optics                                            → четыре водных
 *     параметра `w_*.xml` всех погод (не модификатор: модификатор без
 *     сценария, который его включит, — пустышка).
 *
 * Оптика правится МНОЖИТЕЛЕМ поверх кривой игрока, а не константой: блик воды
 * живёт по солнцу, и записать в файл ровную сотню процентов значило бы стереть
 * закатный пик, который человек в окне как раз видел. Сто процентов — «как в
 * игре» — не пишет ничего; выключенное отражение — единственная константа,
 * потому что выключатель и есть константа.
 */

/** Куда патч ложится в архиве игрока. */
export const WATER_ARCHIVE_ENTRY = "update:/common/data/levels/gta5/water.xml";

/**
 * Откуда читается база. Сначала override в `update.rpf` — если игрок уже
 * ставил водный мод, правки обязаны лечь поверх него; ванильный файл живёт в
 * `common.rpf` и берётся, когда override нет.
 */
export const WATER_BASE_ENTRIES = Object.freeze([
  WATER_ARCHIVE_ENTRY,
  "common:/data/levels/gta5/water.xml",
]);

/** Файл ставится тем же именем в payload патча. */
export const WATER_PAYLOAD_FILE = "water.xml";

/*
 * Штатная поверхность — залив: ванильная зыбь океана. Проект, не ушедший от
 * неё, не правит `water.xml` вовсе. Совпадение с DEFAULTS окна закреплено
 * тестом `tests/water-quads.test.js`.
 */
export const WATER_DEFAULT_SURFACE = Object.freeze({
  amplitude: 0.1,
  direction: 250,
  dampening: 0.05,
  level: 0,
});

export const WATER_DEFAULT_OPTICS = Object.freeze({
  reflection: true,
  specular: 100,
  foam: 100,
  drying: 100,
});

/* Пределы — копия контракта окна (`water-model.js`), проверяемая тестом. */
const RANGES = Object.freeze({
  amplitude: { min: 0, max: 0.8, step: 0.01 },
  direction: { min: 0, max: 359, step: 1 },
  dampening: { min: 0, max: 1, step: 0.01 },
  level: { min: -4, max: 4, step: 0.1 },
  specular: { min: 0, max: 200, step: 1 },
  foam: { min: 0, max: 200, step: 1 },
  drying: { min: 0, max: 300, step: 1 },
});

const clampTo = (range, value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const held = Math.min(Math.max(numeric, range.min), range.max);
  return Number((Math.round(held / range.step) * range.step).toFixed(4));
};

/** Проект воды, приведённый к пределам игры. Чужой файл проходит здесь же. */
export function boundWaterProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Проект воды обязателен.");
  const surface = input.surface || {};
  const optics = input.optics || {};
  return {
    name: String(input.name ?? "Вода").slice(0, 80) || "Вода",
    surface: {
      amplitude: clampTo(
        RANGES.amplitude,
        surface.amplitude,
        WATER_DEFAULT_SURFACE.amplitude,
      ),
      direction: clampTo(
        RANGES.direction,
        surface.direction,
        WATER_DEFAULT_SURFACE.direction,
      ),
      dampening: clampTo(
        RANGES.dampening,
        surface.dampening,
        WATER_DEFAULT_SURFACE.dampening,
      ),
      level: clampTo(RANGES.level, surface.level, WATER_DEFAULT_SURFACE.level),
    },
    optics: {
      reflection: optics.reflection !== false,
      specular: clampTo(
        RANGES.specular,
        optics.specular,
        WATER_DEFAULT_OPTICS.specular,
      ),
      foam: clampTo(RANGES.foam, optics.foam, WATER_DEFAULT_OPTICS.foam),
      drying: clampTo(
        RANGES.drying,
        optics.drying,
        WATER_DEFAULT_OPTICS.drying,
      ),
    },
  };
}

/**
 * Направление волны в полях игры: нормализованный вектор, ноль градусов —
 * на север, дальше по часовой, как на компасе. Формула обязана совпадать с
 * окном — сверяется тестом.
 */
export function waveDirectionVector(degrees) {
  const radians = ((Number(degrees) || 0) * Math.PI) / 180;
  return {
    x: Number(Math.sin(radians).toFixed(4)),
    y: Number(Math.cos(radians).toFixed(4)),
  };
}

/**
 * Что человек в самом деле двинул в квадах.
 *
 * Поле, оставшееся штатным, в правку не попадает: у ванильных волновых квадов
 * НАПРАВЛЕНИЯ РАЗНЫЕ, и записать всем «штатные 250°» значило бы разгладить
 * карту волн, которой человек не касался.
 */
export function waterQuadEdits(project) {
  const value = boundWaterProject(project);
  const edits = {};
  if (value.surface.amplitude !== WATER_DEFAULT_SURFACE.amplitude)
    edits.amplitude = value.surface.amplitude;
  if (value.surface.direction !== WATER_DEFAULT_SURFACE.direction)
    edits.direction = waveDirectionVector(value.surface.direction);
  if (value.surface.dampening !== WATER_DEFAULT_SURFACE.dampening)
    edits.dampening = value.surface.dampening;
  if (value.surface.level !== WATER_DEFAULT_SURFACE.level)
    edits.level = value.surface.level;
  return edits;
}

/**
 * Правки оптики для файлов таймцикла.
 *
 * `scale` — множитель поверх кривой игрока, `set` — константа. Имена — только
 * настоящие, из ванильного набора параметров: выдуманное поле игра молча
 * игнорирует, и мод выходит пустышкой.
 */
export function waterOpticsEdits(project) {
  const value = boundWaterProject(project);
  const edits = [];
  if (!value.optics.reflection)
    edits.push({ parameter: "water_reflection", set: 0 });
  if (value.optics.specular !== WATER_DEFAULT_OPTICS.specular)
    edits.push({
      parameter: "water_specular_intensity",
      scale: value.optics.specular / 100,
    });
  if (value.optics.foam !== WATER_DEFAULT_OPTICS.foam)
    edits.push({
      parameter: "water_foam_intensity_mult",
      scale: value.optics.foam / 100,
    });
  if (value.optics.drying !== WATER_DEFAULT_OPTICS.drying)
    edits.push({
      parameter: "water_drying_speed_mult",
      scale: value.optics.drying / 100,
    });
  return edits;
}

/**
 * Накладывает правки оптики на разобранный документ `w_*.xml`
 * (форма — `parseKeyframeXml` из `@modovik/timecycle`). Меняет документ на
 * месте; правит все регионы, где параметр есть, — вода одна на весь остров.
 *
 * Отсутствующий в базе параметр пропускается и называется по имени: молчание
 * здесь означало бы мод-пустышку, который не отличить от работающего.
 */
export function applyWaterOptics(document, edits) {
  let applied = 0;
  const skipped = [];
  for (const edit of edits || []) {
    let found = false;
    for (const region of document?.regions || []) {
      const samples = region.values?.[edit.parameter];
      if (!Array.isArray(samples)) continue;
      found = true;
      region.values[edit.parameter] = samples.map((sample) =>
        Number.isFinite(edit.scale)
          ? Number((sample * edit.scale).toFixed(4))
          : edit.set,
      );
      applied += 1;
    }
    if (!found) skipped.push(edit.parameter);
  }
  return { applied, skipped };
}

/**
 * Манифест патча — те же поля, что у неба и мини-карты, чтобы
 * `install-rpf-patch` не знал про воду ничего.
 *
 * `water.xml` идёт действием Import, а не Replace: в ванильном `update.rpf`
 * override воды нет, а Replace по отсутствующей записи инжектор молча
 * пропускает — мод «встал» бы и не появился в игре. Import и заменяет
 * существующую запись, и добавляет отсутствующую.
 */
export function waterPatchManifest({ name, files }) {
  return {
    ReduxName: name || "Astral water",
    ParsedAt: new Date().toISOString(),
    TotalPatchSize: files.reduce((total, file) => total + file.size, 0),
    Actions: files.map((file) => ({
      Type: file.target === WATER_ARCHIVE_ENTRY ? "Import" : "Replace",
      TargetPath: file.target,
      SourcePath: `payload/${file.file}`,
      Size: file.size,
      Sha256: file.sha256,
      IsWholeReplaceNestedRpf: false,
    })),
  };
}
