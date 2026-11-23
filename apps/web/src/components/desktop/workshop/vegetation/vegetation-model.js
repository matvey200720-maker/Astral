
import { tr } from "../../../../locales/ui.js";
/*
 * Растительность: что человек правит и в каких величинах.
 *
 * Слот `vegetation` до сих пор жил четырьмя прямоугольниками в карточке
 * студии: выбрать чужой мод было можно, тронуть — нет. Здесь описано то, что в
 * растительности правят на самом деле.
 *
 * Величины подписаны так, как их видит глаз, а не так, как их удобно считать
 * сцене. Плотность — в пучках на квадратный метр: «шестьдесят процентов»
 * ничего не говорит, а «тридцать пучков на метр» говорит сразу, и по этому же
 * числу считается количество экземпляров. Пучок, а не травинка: в игре трава
 * стоит не отдельными былинками, а карточками с нарисованным на них кустиком
 * из десятка стеблей, и считать здесь былинки значило бы называть числом то,
 * чего в сцене нет. Высота — в сантиметрах: газон это
 * пятнадцать, степь — шестьдесят, и разницу между ними человек знает без
 * пересчёта. Дальность — в метрах, потому что дальше неё травы не будет, и это
 * единственная настройка, которая в кадре видна ребром.
 *
 * Модель держится отдельно от сцены и от разметки редактора: сцена её только
 * читает, а проверяется она целиком и без окна.
 */

export const VEGETATION_SLOT_ID = "vegetation";
export const VEGETATION_PROJECT_FORMAT = "astral-vegetation";
export const VEGETATION_PROJECT_VERSION = 1;

/*
 * Потолок числа травинок.
 *
 * Не «сколько влезет», а сколько окно обязано вытянуть на средней машине,
 * оставаясь окном предпросмотра рядом с запущенной игрой. Всё поле — один
 * вызов отрисовки, поэтому цена потолка это вершины и фрагменты, а не вызовы:
 * шестьдесят тысяч карточек по восемь вершин — под полмиллиона вершин.
 * Замерено таймером видеокарты на стенде окна (кадр 1098×556, тени включены,
 * `EXT_disjoint_timer_query_webgl2`): пятьдесят четыре тысячи пучков — 3,8 мс
 * на ВЕСЬ кадр вместе с небом и картой теней, шестьдесят тысяч — 4,1 мс, семь
 * вызовов отрисовки в обоих случаях. Разница в шесть тысяч карточек стоит
 * трёх десятых миллисекунды: кадр здесь упирается во фрагменты земли и купола,
 * а не в плотность травы, и поднимать потолок ради «ещё гуще» бессмысленно по
 * той же причине, по которой его незачем опускать.
 *
 * Потолок стоит там, где кончается запас, а не там, где начинает мешать.
 *
 * Число живёт здесь, а не в сцене, потому что по нему считается ползунок:
 * плотность в травинках на метр упирается в этот потолок на большой дальности,
 * и редактор обязан сказать об этом человеку, а не молча отрисовать половину.
 */
export const GRASS_CAPACITY = 60000;

/**
 * Самый дальний край поля, какой редактор разрешает попросить.
 *
 * Это верх ползунка дальности, а не размер буфера: круг мест у сцены
 * единичный и растягивается до запрошенной дальности (см. `VERTEX_BODY` в
 * `vegetation-scene.js`). Потолок стоит потому, что счёт растёт как квадрат
 * дальности: девяносто метров при десяти пучках на метр — это уже двести
 * пятьдесят тысяч карточек, вчетверо больше потолка.
 */
export const GRASS_MAX_RADIUS = 90;

/**
 * Типы покрова.
 *
 * Три, и это не «три пресета», а три разных растения с разной геометрией: у
 * степи высокие редкие метёлки, у газона низкая густая щётка, у кустарника
 * трава уходит на второй план, а кадр держат кусты. Поэтому у покрова свои
 * текстуры и свои штатные числа, а не только цвет.
 *
 * `ground`, `blade`, `bush`, `leaf`, `bark`, `litter` — имена ассетов из набора
 * `vegetation` пакета `@modovik/gta-preview-assets`. Их может не быть (игра не
 * подключена, извлечение не запускали) — тогда сцена рисует своё, см.
 * `vegetation-textures.js`.
 *
 * `bushes` и `trees` — не украшение, а масштаб кадра. Раньше их было три и
 * восемь на кольцо в четверть гектара: за двадцатью шестью метрами и до самого
 * тумана стояла пустая плоская земля, и мир читался зелёной тарелкой посреди
 * пустоты. Числа подняты до линии леса; потолки под них стоят в сцене
 * (`BUSH_CAPACITY`, `TREE_CAPACITY`), и буфер матриц выделяется по потолку.
 */
export const VEGETATION_COVERS = Object.freeze([
  Object.freeze({
    id: "steppe",
    label: "Степь",
    hint: "Сухая метёлка по колено, кусты редкие",
    ground: "ground-steppe",
    blade: "grass-dry",
    bush: "bush-branches",
    leaf: "tree-palm-frond",
    bark: "bark-palm",
    litter: "grass-flowers",
    colour: "#a89b5c",
    height: 62,
    density: 10,
    spread: 55,
    bushes: 16,
    trees: 11,
  }),
  Object.freeze({
    id: "lawn",
    label: "Газон",
    hint: "Низкая густая щётка, стриженые кусты",
    ground: "ground-lawn",
    blade: "grass-blades",
    bush: "hedge-leaves",
    leaf: "tree-oak-leaves",
    bark: "bark-oak",
    litter: "grass-flowers",
    colour: "#5f8437",
    height: 17,
    density: 30,
    spread: 22,
    bushes: 22,
    trees: 14,
  }),
  Object.freeze({
    id: "scrub",
    label: "Кусты",
    hint: "Заросли: трава пореже, кустов много",
    ground: "ground-meadow",
    blade: "grass-tuft",
    bush: "bush-leaves",
    leaf: "tree-oak-leaves",
    bark: "bark-oak",
    litter: "grass-reeds",
    colour: "#6d8342",
    height: 42,
    density: 8,
    spread: 70,
    bushes: 58,
    trees: 18,
  }),
  Object.freeze({
    /* Четвёртый покров заведён не «для полноты списка»: хвоя и камыш лежали в
       рецепте извлечения и не попадали в кадр ни разу, а между тем это
       единственные в наборе тёмная крона и высокая осока. */
    id: "pine",
    label: "Сосняк",
    hint: "Тёмная хвоя, редкий подлесок, осока в тени",
    ground: "ground-dirt",
    blade: "grass-tuft",
    bush: "bush-leaves",
    leaf: "tree-pine-leaves",
    bark: "bark-oak",
    litter: "grass-reeds",
    colour: "#4d6b34",
    height: 34,
    density: 12,
    spread: 62,
    bushes: 30,
    trees: 24,
  }),
]);

export const VEGETATION_COVER_IDS = Object.freeze(
  VEGETATION_COVERS.map((cover) => cover.id),
);

/** Ракурсы окна превью. Имена — те, что понимает `PreviewWindow`. */
export const VEGETATION_CAMERAS = Object.freeze([
  Object.freeze({ value: "orbit", label: "С высоты роста" }),
  Object.freeze({ value: "static", label: "Неподвижно" }),
]);

/**
 * Часы, ради которых редактор показывает сутки.
 *
 * Зелень читается не «днём и ночью», а на контровом свете: та же трава на
 * закате просвечивает насквозь, а в полдень стоит плотной массой. Ночь здесь
 * тоже нужна — по ней видно, не светится ли листва сама по себе.
 */
export const TIME_MARKS = Object.freeze([
  Object.freeze({ id: "dawn", label: "Рассвет", hour: 6.4 }),
  Object.freeze({ id: "day", label: "День", hour: 12.5 }),
  Object.freeze({ id: "dusk", label: "Закат", hour: 19.2 }),
  Object.freeze({ id: "night", label: "Ночь", hour: 23.5 }),
]);

/** Пределы ползунков. Одно место на редактор, сцену и разбор чужого файла. */
export const VEGETATION_RANGES = Object.freeze({
  /* Пучков на квадратный метр. Верх — газон в упор: тридцать пучков это
     сплошная щётка без просветов, шестьдесят — запас на то, чтобы человек
     увидел, где начинается бессмысленное. Выше глаз уже не различает
     отдельных пучков, а кадр дорожает линейно. */
  density: Object.freeze({ min: 0, max: 60, step: 1 }),
  /* Сантиметры. Ниже пяти трава читается как ворс на земле, выше полутора
     метров — как камыш, и то и другое в игре есть. */
  height: Object.freeze({ min: 5, max: 150, step: 1 }),
  spread: Object.freeze({ min: 0, max: 100, step: 1 }),
  colourSpread: Object.freeze({ min: 0, max: 100, step: 1 }),
  distance: Object.freeze({ min: 10, max: GRASS_MAX_RADIUS, step: 1 }),
  windStrength: Object.freeze({ min: 0, max: 100, step: 1 }),
  windSpeed: Object.freeze({ min: 10, max: 200, step: 5 }),
  /* Румб, ОТКУДА дует, как у метеорологов: «северный ветер» — это ветер с
     севера, и переучивать человека ради удобства шейдера незачем. Шаг в пять
     градусов, потому что различить в кадре меньшее нельзя. */
  windDirection: Object.freeze({ min: 0, max: 355, step: 5 }),
  timeOfDay: Object.freeze({ min: 0, max: 24, step: 0.1 }),
});

const HEX = /^#[0-9a-f]{6}$/i;

/** Цвет либо есть, либо берётся штатный: половинчатых значений тут не бывает. */
function colour(value, fallback) {
  return HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback;
}

const decimals = (step) =>
  String(step).includes(".") ? String(step).split(".")[1].length : 0;

/**
 * Число в пределах ползунка и с его же шагом.
 *
 * Шаг применяется здесь, а не в разметке: чужой файл приходит с любыми дробями,
 * и без округления ползунок вставал бы между делениями.
 */
export function clampTo(range, value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const bounded = Math.min(Math.max(numeric, range.min), range.max);
  const stepped = Math.round(bounded / range.step) * range.step;
  return Number(stepped.toFixed(decimals(range.step)));
}

const pick = (list, value, fallback) =>
  list.includes(value) ? value : fallback;

export function coverById(id) {
  return (
    VEGETATION_COVERS.find((cover) => cover.id === id) || VEGETATION_COVERS[0]
  );
}

const COMPASS = Object.freeze([
  "северный",
  "северо-восточный",
  "восточный",
  "юго-восточный",
  "южный",
  "юго-западный",
  "западный",
  "северо-западный",
]);

/**
 * Румб словами.
 *
 * Триста пятнадцать градусов человеку не говорят ничего: их надо держать в
 * голове вместе с розой ветров. «Северо-западный» — говорит сразу, и по нему
 * видно, совпало ли направление в кадре с тем, что просили.
 */
export function windCompass(degrees) {
  const turn = (((Number(degrees) || 0) % 360) + 360) % 360;
  return tr(COMPASS[Math.round(turn / 45) % 8]);
}

/**
 * Куда дует, единичным вектором в осях сцены.
 *
 * Румб задан «откуда», а шейдеру нужно «куда», и разворот на сто восемьдесят
 * градусов живёт ЗДЕСЬ, а не в сцене: перепутанный знак виден только глазами и
 * только на сильном ветре, а числами проверяется в один вызов.
 * Север у сцены — это -Z, как у карты.
 */
export function windVector(degrees) {
  const radians = ((Number(degrees) || 0) * Math.PI) / 180;
  return [-Math.sin(radians), Math.cos(radians)];
}

/**
 * Сколько пучков травы нарисуется при этих плотности и дальности.
 *
 * Считается по площади круга, а не по проценту: плотность задана на
 * квадратный метр, и удвоение дальности учетверяет счёт. Именно здесь живёт
 * потолок — без него ползунок дальности на густом газоне просил бы у видеокарты
 * миллион карточек и получал бы застывшее окно вместо кадра.
 */
export function grassCount({ density, distance }) {
  const wanted = Math.round(density * Math.PI * distance * distance);
  return Math.max(0, Math.min(GRASS_CAPACITY, wanted));
}

/** Уперлись в потолок — редактор обязан сказать об этом, а не молчать. */
export function grassIsCapped(grass) {
  return (
    Math.round(grass.density * Math.PI * grass.distance * grass.distance) >
    GRASS_CAPACITY
  );
}

/* Штатное имя вынесено из `createVegetationProject`: по нему же счёт правок
   решает, есть ли у человека несохранённая работа. */
const DEFAULT_NAME = "Моя растительность";

/** Имя приводится так же, как при разборе файла: пустое и пробельное — штатное. */
function normalizedName(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 80)
    : DEFAULT_NAME;
}

const DEFAULTS = Object.freeze({
  cover: Object.freeze({ kind: "lawn", groundId: "" }),
  grass: Object.freeze({
    density: 30,
    height: 17,
    spread: 22,
    colour: "#5f8437",
    colourSpread: 35,
    distance: 24,
  }),
  wind: Object.freeze({ strength: 30, speed: 60, direction: 315 }),
  view: Object.freeze({ camera: "orbit", timeOfDay: 12.5 }),
});

/** Штатная растительность — та, с которой редактор открывается. */
export function defaultVegetationProject() {
  return {
    cover: { ...DEFAULTS.cover },
    grass: { ...DEFAULTS.grass },
    wind: { ...DEFAULTS.wind },
    view: { ...DEFAULTS.view },
  };
}

/**
 * Штатные числа выбранного покрова.
 *
 * Смена покрова — это смена растения, а не перекраска: степная метёлка ростом
 * с газонную щётку выглядит подстриженным полем, а не степью. Поэтому переход
 * тянет за собой высоту, плотность, разброс и цвет.
 */
export function coverDefaults(kind) {
  const cover = coverById(kind);
  return {
    height: cover.height,
    density: cover.density,
    spread: cover.spread,
    colour: cover.colour,
  };
}

/**
 * Проект растительности из чего угодно: из ничего, из своего файла, из чужого.
 *
 * Пропущенное берётся штатным, лишнее отбрасывается, числа приводятся к
 * пределам ползунков. Ошибок тут не бывает по замыслу: разобранный файл должен
 * открываться, даже если его правили руками.
 */
export function createVegetationProject(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const cover = source.cover || {};
  const grass = source.grass || {};
  const wind = source.wind || {};
  const view = source.view || {};
  const kind = pick(VEGETATION_COVER_IDS, cover.kind, DEFAULTS.cover.kind);
  const base = coverDefaults(kind);

  return {
    name: normalizedName(source.name),
    cover: {
      kind,
      /* Текстура земли из установленной игры, если пакет её отдал. Пустая
         строка — «штатная для этого покрова»: редактор обязан работать без
         игры, и выбор в списке не должен быть обязательным. */
      groundId:
        typeof cover.groundId === "string" ? cover.groundId.slice(0, 120) : "",
    },
    grass: {
      density: clampTo(VEGETATION_RANGES.density, grass.density, base.density),
      height: clampTo(VEGETATION_RANGES.height, grass.height, base.height),
      spread: clampTo(VEGETATION_RANGES.spread, grass.spread, base.spread),
      colour: colour(grass.colour, base.colour),
      colourSpread: clampTo(
        VEGETATION_RANGES.colourSpread,
        grass.colourSpread,
        DEFAULTS.grass.colourSpread,
      ),
      distance: clampTo(
        VEGETATION_RANGES.distance,
        grass.distance,
        DEFAULTS.grass.distance,
      ),
    },
    wind: {
      strength: clampTo(
        VEGETATION_RANGES.windStrength,
        wind.strength,
        DEFAULTS.wind.strength,
      ),
      speed: clampTo(
        VEGETATION_RANGES.windSpeed,
        wind.speed,
        DEFAULTS.wind.speed,
      ),
      direction: clampTo(
        VEGETATION_RANGES.windDirection,
        wind.direction,
        DEFAULTS.wind.direction,
      ),
    },
    view: {
      camera: pick(
        VEGETATION_CAMERAS.map((entry) => entry.value),
        view.camera,
        DEFAULTS.view.camera,
      ),
      timeOfDay: clampTo(
        VEGETATION_RANGES.timeOfDay,
        view.timeOfDay,
        DEFAULTS.view.timeOfDay,
      ),
    },
  };
}

const SECTIONS = ["cover", "grass", "wind"];

/**
 * Что в проекте правлено.
 *
 * Вид (ракурс, час) в счёт не идёт: это взгляд, а не работа, и кнопка
 * «Сохранить» не должна загораться от того, что человек посмотрел на поле
 * ночью.
 *
 * Имя — идёт: это единственное поле, которое человек правит руками и которое
 * ложится в файл. Пока счёт его не видел, переименованный, но не тронутый
 * проект считался штатным: «Сохранить» оставалась серой, а снимок в хранилище
 * браузера стирался — имя не переживало закрытия редактора. Сравнивается
 * ПРИВЕДЁННОЕ имя: пустую строку и хвостовые пробелы разбор файла всё равно
 * вернёт к штатному, и правкой они не считаются.
 */
export function vegetationProjectStats(project) {
  const base = defaultVegetationProject();
  const changed = {};
  for (const section of SECTIONS) {
    changed[section] =
      JSON.stringify(project[section]) !== JSON.stringify(base[section]);
  }
  changed.name = normalizedName(project.name) !== DEFAULT_NAME;
  return {
    ...changed,
    changes:
      SECTIONS.filter((section) => changed[section]).length +
      (changed.name ? 1 : 0),
  };
}

export function vegetationProjectIsDefault(project) {
  return vegetationProjectStats(project).changes === 0;
}

/** Одна честная строка под заголовком редактора. */
export function describeVegetationProject(project) {
  const cover = coverById(project.cover.kind);
  return [
    tr(cover.label.toLowerCase()),
    tr("{count} пучков/м²").replace("{count}", project.grass.density),
    tr("{count} см").replace("{count}", project.grass.height),
    tr("видно на {count} м").replace("{count}", project.grass.distance),
    project.wind.strength > 0
      ? tr("ветер {dir} {strength}%")
          .replace("{dir}", windCompass(project.wind.direction))
          .replace("{strength}", project.wind.strength)
      : tr("без ветра"),
  ].join(" · ");
}

export function serializeVegetationProject(project) {
  return JSON.stringify(
    {
      format: VEGETATION_PROJECT_FORMAT,
      version: VEGETATION_PROJECT_VERSION,
      ...createVegetationProject(project),
    },
    null,
    2,
  );
}

/**
 * Разбор своего файла.
 *
 * Чужой формат отбивается по метке, а не по тому, что внутри не нашлось полей:
 * иначе проект дорог открылся бы штатным газоном и выглядел бы как потеря
 * работы, а не как отказ.
 */
export function parseVegetationProject(raw) {
  let value = null;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(tr("Файл не читается как проект растительности"));
  }
  if (!value || value.format !== VEGETATION_PROJECT_FORMAT) {
    throw new Error(tr("Это не проект растительности Astral"));
  }
  /* Файл из более новой мастерской отбивается честно, а не открывается с молча
     выброшенными полями: половина проекта, показанная как весь, читается как
     потеря работы. Старые файлы (номер меньше либо его нет) открываются —
     пропуски разбор терпит по замыслу. */
  if (Number(value.version) > VEGETATION_PROJECT_VERSION) {
    throw new Error(
      tr("Файл из более новой мастерской растительности — обновите Astral"),
    );
  }
  return createVegetationProject(value);
}
