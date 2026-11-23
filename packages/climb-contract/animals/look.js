/*
 * Облик животного — то, что человек настраивает в редакторе «Животные» (05.11.2026), и границы, в которых это допустимо.
 *
 * Три независимые вещи, у каждой свой выключатель:
 *   • `colour` — перекраска: текстуры тела животного (все расцветки) приводятся к выбранному цвету с сохранением светотени
 *     (формулы `recolor/colour.js`, те же, что у кадра окна и у установщика). Меняются только пиксели `*_diff_*`-листов;
 *   • `glow` — подсветка: полупрозрачная светящаяся оболочка по форме тела на 1–4 см больше самого тела (шейдер
 *     `emissive_alpha`). Тело, его кости, физика и столкновения не меняются;
 *   • `marker` — метка над животным на высоте от 2 до 12 м, по желанию «палочка» от тела до метки. Это новая геометрия в
 *     модели тела (скинована на корневую кость), видна из любого направления и светится ночью. Вида три (06.11.2026):
 *     `icon` — готовый значок-силуэт, `emblem` — своя картинка человека (PNG/JPG/WebP, в работе — отпечаток SHA-256 уже
 *     подготовленной картинки), `model` — копия самого животного одним цветом (`buildModelMarker`).
 *
 * Размер животного НЕ настраивается. Телу в игре задан размер двумя независимыми вещами — моделью (файл `.ydd`) и физикой
 * (капсула попаданий и кости рэгдолла в `.yft`); масштаб модели без физики развёл бы то, что видно, и то, во что попадает
 * пуля, а на RP-серверах это читается как подмена хитбокса. Скелет и анимации привязаны к размерам костей, поэтому
 * честного «побольше/поменьше» файлами игры не сделать (подробно — `launcher_app/docs/ANIMALS.md`).
 *
 * Границы — не прихоть: метка выше 12 м вышла бы за шар видимости модели (радиус 17,7 м у `.yft` животных), оболочка толще
 * 4 см стала бы отдельным предметом вокруг животного, а множитель свечения выше 6 выжигает значок в белое пятно.
 */

import { animalById, animalInstallable } from "./catalog.js";
import { normalizeRecolourHex } from "../recolor/colour.js";
import { ICON_IDS, defaultIconFor } from "./icons.js";

export const ANIMALS_SCHEMA = 1;

/** Виды метки: готовый значок, своя картинка, копия животного одним цветом. */
export const MARKER_KINDS = Object.freeze(["icon", "emblem", "model"]);
/** Отпечаток своей эмблемы: SHA-256 подготовленного PNG, строчные шестнадцатеричные. */
export const EMBLEM_HASH = /^[0-9a-f]{64}$/;

export const ANIMAL_LIMITS = Object.freeze({
  strength: Object.freeze({ min: 0.1, max: 1, standard: 1 }),
  brightness: Object.freeze({ min: 0.6, max: 1.4, standard: 1 }),
  /* Свечение оболочки: множитель шейдера и толщина слоя в сантиметрах. */
  glowPower: Object.freeze({ min: 0.5, max: 4, standard: 1.5 }),
  glowReach: Object.freeze({ min: 1, max: 4, standard: 2 }),
  glowAlpha: Object.freeze({ min: 0.1, max: 0.6, standard: 0.3 }),
  /* Метка: высота центра значка над корнем, сторона значка (метры), свечение. */
  markerHeight: Object.freeze({ min: 2, max: 12, standard: 6 }),
  markerSize: Object.freeze({ min: 0.6, max: 3, standard: 1.4 }),
  markerPower: Object.freeze({ min: 0.5, max: 6, standard: 2.5 }),
  /* Копия животного в небе: длинная сторона копии, метры. */
  markerModelSize: Object.freeze({ min: 1, max: 6, standard: 2.5 }),
  /* Своя эмблема: непрозрачность картинки (прозрачность самой картинки остаётся, ползунок ослабляет её целиком). */
  markerOpacity: Object.freeze({ min: 0.1, max: 1, standard: 1 }),
});

export const ANIMAL_DEFAULTS = Object.freeze({
  colour: "#c4562e",
  glow: "#5fe0ff",
  marker: "#ffd23f",
});

const clamp = (value, range, fallback) => {
  const number = Number(value);
  const base = Number.isFinite(number) ? number : fallback;
  return Math.max(range.min, Math.min(range.max, base));
};
/* Числа в работе короткие: два знака — хватает ползунку и держит отпечаток стабильным. */
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Нормальная форма одного облика: выключенные части сохраняют настройки, чтобы они не терялись при переключении. */
export function normalizeAnimalLook(input, animalId = "") {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const colour = source.colour && typeof source.colour === "object" ? source.colour : {};
  const glow = source.glow && typeof source.glow === "object" ? source.glow : {};
  const marker = source.marker && typeof source.marker === "object" ? source.marker : {};
  const animal = animalById(animalId);
  const icon = ICON_IDS.includes(String(marker.icon)) ? String(marker.icon) : defaultIconFor(animal?.id || animalId);
  return {
    colour: {
      on: colour.on === true,
      hex: normalizeRecolourHex(colour.hex, ANIMAL_DEFAULTS.colour),
      strength: round(clamp(colour.strength, ANIMAL_LIMITS.strength, ANIMAL_LIMITS.strength.standard)),
      brightness: round(clamp(colour.brightness, ANIMAL_LIMITS.brightness, ANIMAL_LIMITS.brightness.standard)),
    },
    glow: {
      on: glow.on === true,
      hex: normalizeRecolourHex(glow.hex, ANIMAL_DEFAULTS.glow),
      power: round(clamp(glow.power, ANIMAL_LIMITS.glowPower, ANIMAL_LIMITS.glowPower.standard)),
      reach: round(clamp(glow.reach, ANIMAL_LIMITS.glowReach, ANIMAL_LIMITS.glowReach.standard), 1),
      alpha: round(clamp(glow.alpha, ANIMAL_LIMITS.glowAlpha, ANIMAL_LIMITS.glowAlpha.standard)),
    },
    marker: {
      on: marker.on === true,
      kind: MARKER_KINDS.includes(String(marker.kind)) ? String(marker.kind) : "icon",
      icon,
      /* Своя эмблема — отпечаток картинки; чужой или битый отпечаток — «картинки нет». */
      emblem: EMBLEM_HASH.test(String(marker.emblem)) ? String(marker.emblem) : "",
      hex: normalizeRecolourHex(marker.hex, ANIMAL_DEFAULTS.marker),
      height: round(clamp(marker.height, ANIMAL_LIMITS.markerHeight, ANIMAL_LIMITS.markerHeight.standard), 1),
      size: round(clamp(marker.size, ANIMAL_LIMITS.markerSize, ANIMAL_LIMITS.markerSize.standard)),
      modelSize: round(clamp(marker.modelSize, ANIMAL_LIMITS.markerModelSize, ANIMAL_LIMITS.markerModelSize.standard), 1),
      opacity: round(clamp(marker.opacity, ANIMAL_LIMITS.markerOpacity, ANIMAL_LIMITS.markerOpacity.standard)),
      /* «Палочка»: линия от животного до значка. */
      pole: marker.pole !== false,
      power: round(clamp(marker.power, ANIMAL_LIMITS.markerPower, ANIMAL_LIMITS.markerPower.standard)),
    },
  };
}

/**
 * Чего не хватает включённому облику, чтобы ставиться: `["marker-emblem"]` — выбран вид «своя эмблема», а картинки нет.
 * Окно не даёт «Применить» с такой меткой, сборка отказывает словами: тихо подменить эмблему значком нельзя.
 */
export function animalLookProblems(look) {
  const problems = [];
  if (look?.marker?.on && look.marker.kind === "emblem" && !look.marker.emblem) problems.push("marker-emblem");
  return problems;
}

/** Отпечатки своих эмблем, нужные работе (включённые метки вида `emblem`): `Set` — по одному на картинку. */
export function animalEmblemHashes(project) {
  const hashes = new Set();
  for (const look of Object.values(normalizeAnimalsProject(project).animals)) if (look.marker.on && look.marker.kind === "emblem" && look.marker.emblem) hashes.add(look.marker.emblem);
  return hashes;
}

/** Что-то включено: такой облик меняет файлы игры. */
export const animalLookIsActive = (look) => Boolean(look?.colour?.on || look?.glow?.on || look?.marker?.on);

/** Меняется ли модель (`.ydd`): метка и свечение — да, перекраска — только текстуры. */
export const animalLookTouchesModel = (look) => Boolean(look?.glow?.on || look?.marker?.on);

/**
 * Работа целиком: `{ schemaVersion, animals: { [id]: облик } }`. Остаются только животные базовой игры (их можно поставить)
 * с включённой настройкой; остальное отбрасывается без ошибки — старые работы переживают смену списка.
 */
export function normalizeAnimalsProject(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const animals = {};
  const given = source.animals && typeof source.animals === "object" && !Array.isArray(source.animals) ? source.animals : {};
  for (const id of Object.keys(given).sort()) {
    const animal = animalById(id);
    if (!animal || !animalInstallable(animal)) continue;
    const look = normalizeAnimalLook(given[id], animal.id);
    if (animalLookIsActive(look)) animals[animal.id] = look;
  }
  return { schemaVersion: ANIMALS_SCHEMA, animals };
}

export const animalsProjectIsEmpty = (project) => Object.keys(project?.animals || {}).length === 0;

/** Облик животного в работе или «ничего не меняю». */
export function animalLookOf(project, animalId) {
  return normalizeAnimalLook(project?.animals?.[animalId], animalId);
}

/* Вид «значок» — ключ прежний (отпечатки уже поставленных работ не меняются), у остальных видов — свой состав. */
function markerKey(marker) {
  if (marker.kind === "emblem") return ["emblem", marker.emblem, marker.hex, marker.height, marker.size, marker.pole, marker.power, marker.opacity];
  if (marker.kind === "model") return ["model", marker.hex, marker.height, marker.modelSize, marker.pole, marker.power];
  return [marker.icon, marker.hex, marker.height, marker.size, marker.pole, marker.power];
}

/** Стабильная строка работы: по ней считается отпечаток пакета (одна и та же работа — один и тот же пакет). */
export function animalsProjectKey(project) {
  const normal = normalizeAnimalsProject(project);
  return JSON.stringify(
    Object.keys(normal.animals).map((id) => {
      const look = normal.animals[id];
      return [
        id,
        look.colour.on ? [look.colour.hex, look.colour.strength, look.colour.brightness] : 0,
        look.glow.on ? [look.glow.hex, look.glow.power, look.glow.reach, look.glow.alpha] : 0,
        look.marker.on ? markerKey(look.marker) : 0,
      ];
    }),
  );
}
