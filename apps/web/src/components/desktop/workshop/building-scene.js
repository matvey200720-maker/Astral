/*
 * Одно здание из установленной GTA V для общего окна предпросмотра.
 *
 * Это по-прежнему просмотр, а не редактор: за заправкой не стоит ни контракта
 * поверхностей, ни установки overlay, и пустой редактор с неработающими слоями
 * был бы обманом. Но просмотр обязан показывать место, а не модель на
 * подставке, и с тех пор в сцене появилось четыре вещи, каждая — из данных
 * игры, а не из подобранных чисел:
 *
 *  • ФОРКОРТ И ЗЕМЛЯ. Покрытие берётся из набора окна по именам, которые в нём
 *    действительно есть. Раньше здесь стоял id `asphalt`, которого в манифесте
 *    нет вовсе (`scripts/extract-workshop-preview-assets.js`), и набор молча
 *    подменял его процедурным шумом: под заправкой НИКОГДА не было асфальта из
 *    игры, даже у человека с извлечёнными текстурами.
 *  • ЛАМПЫ. Позиции, цвет, яркость, дальность и угол конуса читаются из
 *    LightAttributes самой модели — того же массива, по которому в игре горит
 *    навес. Ни одного источника «на глаз».
 *  • СВЕЧЕНИЕ ВЫВЕСКИ. Материалы, которым игра назначила эмиссионный шейдер
 *    (`emissivenight` и родня), приезжают в GLB с эмиссионным каналом:
 *    конвертер их отмечает сам (нативный конвертер Astral, `EmissiveShaders`).
 *    Сцена не ищет вывеску по именам — она берёт готовую отметку и ведёт её
 *    силу по часу.
 *  • МОКРОЕ ПОКРЫТИЕ. Осадки выводятся из типа погоды одной таблицей на всю
 *    мастерскую (`weather/weather-model.js`), а тип погоды приходит в кадре из
 *    таймцикла.
 *
 * Рендерер, камера, небо, солнце, рассеянный свет и туман приходят из окна
 * (`preview/PreviewWindow.jsx`), а оно берёт их из таймцикла. Сцена не пишет
 * ни в цвет тумана, ни в экспозицию: её дело — что стоит на земле и как оно
 * светится.
 *
 * Отсюда нет ни одного `import * as THREE`: всё строится тем `THREE`, который
 * окно передало в `ctx`. Своя копия движка означала бы вторую сцену рядом с
 * первой.
 *
 * Контракт окна:
 *
 *   mount(ctx)          — поставить здание в чужую сцену;
 *   update(ctx, frame)  — час, погода и дальность тумана этого кадра;
 *   dispose()           — забрать всё своё обратно.
 *
 * Файл называется `*-scene.js` и лежит рядом со своим редактором не по
 * привычке: стенд окна превью (`dev/preview-lab`) обходит мастерскую глобом и
 * берёт в список каждый такой файл, опознавая переходник по форме. Сцена,
 * спрятанная внутри компонента, на стенд не попадает.
 */

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { hasDesktopBridge, loadMegaMallBuildingModel } from "../../../api.js";
import { defaultSetup } from "./weather/weather-model.js";
import { tr } from "../../../locales/ui.js";

/* ---------- покрытия ---------- */

/*
 * Имена покрытий в порядке предпочтения.
 *
 * `tarmac-01` — это `dc_parking_tarmac_01`, буквально покрытие стоянки; за ним
 * идут дорожные полотна, у которых в рецепте есть карта нормалей. Перебор, а
 * не одно имя: набор извлекается с машины человека, и какого-то из архивов у
 * него может не оказаться.
 */
const FORECOURT_IDS = ["tarmac-01", "asphalt-06", "asphalt-01", "asphalt-17"];

/* Земля вокруг форкорта — грунт Sandy Shores. `im_ground_dirt001` и сухая
   трава `tf_rsn_drygrass1` из набора растительности: заправка стоит в пустыне,
   а не на бесконечной парковке. */
const TERRAIN_IDS = ["ground-dirt", "ground-steppe", "ground-meadow"];

/* Кустики по обочине. Карточки с альфой — без настоящей текстуры их не
   строим вовсе (см. `buildScrub`). */
const SCRUB_IDS = ["grass-tuft", "grass-blades", "grass-dry"];

/* ---------- числа сцены ---------- */

/* Форкорт — асфальтовая площадка под самой станцией. Радиус выводится из
   габарита модели: у разных зданий он разный в разы, и одна константа
   означала бы либо асфальт под козырьком, либо стоянку на квартал. */
const FORECOURT_SPAN = 1.7;
const FORECOURT_RANGE = [26, 96];

/* Пояс кустарника за форкортом. Дальше не имеет смысла: на восьмидесяти метрах
   карточка в метр шириной занимает меньше пикселя. */
const SCRUB_REACH = 86;

/* Сколько карточек кустарника по качеству. На слабом качестве их нет: это
   единственная в сцене вещь, которую можно убрать целиком, не сломав кадр. */
const SCRUB_COUNT = { low: 0, medium: 2400, high: 5600 };

/* Плоскостей в карточке. Две — крест: с одной растение исчезает, если зайти
   ему в торец, с трёх оно стоит вдвое дороже, а разницы в кадре нет. */
const SCRUB_PLANES = 2;

/*
 * Порог альфа-теста ЗАНИЖЕН относительно классических 0.5 намеренно: мип
 * усредняет альфу, и с половиной поле лысеет с двадцати метров. То же число
 * стоит в `vegetation/vegetation-scene.js`.
 */
const ALPHA_TEST = 0.28;

/*
 * Кандел на единицу игровой яркости лампы.
 *
 * Ровно то же число, что у редактора фонарей (`street-light-editor/
 * street-light-scene.js`, `LAMP_CANDELA`), и это не совпадение: фонарь и
 * заправка попадают в одно и то же окно с одним и тем же таймциклом, и
 * разъехавшись здесь, они дали бы разный по силе свет от одинаковых ламп
 * игры. Общего места для константы пока нет — оба файла держат её у себя, и
 * менять её можно только вместе.
 */
const LAMP_CANDELA = 26;

/*
 * Сколько живых источников держим по качеству.
 *
 * У навеса заправки ламп может быть под два десятка, и каждая — это ещё один
 * проход по всем материалам в кадре. Берём самые яркие: остальные добавляют
 * к освещённости доли процента, а стоят столько же. Тени не даёт НИ ОДНА —
 * тень в окне одна, солнечная, и вторая карта теней ночью рисовалась бы
 * впустую (`preview/preview-lighting.js`, переезд ключа с солнца на луну).
 */
const LAMP_BUDGET = { low: 1, medium: 4, high: 6 };

/*
 * Собственное свечение эмиссионных материалов ночью.
 *
 * То же число, что у вывески торгового центра (`mega-mall-scene.js`,
 * `SIGN_GLOW`): вывески в одном окне обязаны гореть одинаково.
 */
const SIGN_GLOW = 1.35;

/*
 * Ракурсы.
 *
 * Два расстояния — не то, ради чего открывают заправку: ценность объекта в
 * навесе, вывеске и колонках, а их с общего плана не видно. Числа здесь — доли
 * габарита модели, а не метры: одна и та же таблица обязана работать и на
 * заправке, и на торговом комплексе.
 *
 * Про `yaw` честно: он подобран, а не выведен. Куда у модели «перед», из
 * габаритной коробки не следует, и узнать это можно только глазами на машине с
 * игрой. Поэтому ракурсы разведены по кругу так, чтобы вместе они обошли
 * станцию со всех сторон, а не смотрели в одну стену.
 */
export const BUILDING_VIEWS = Object.freeze([
  /* Подпись — геттер: язык окна читается в момент отрисовки, а не загрузки. */
  Object.freeze({
    value: "overview",
    get label() {
      return tr("Общий вид");
    },
  }),
  Object.freeze({
    value: "canopy",
    get label() {
      return tr("Под навесом");
    },
  }),
  Object.freeze({
    value: "sign",
    get label() {
      return tr("Вывеска");
    },
  }),
  Object.freeze({
    value: "pumps",
    get label() {
      return tr("Колонки"); // у предпросмотра подпись берётся из building-lang.js
    },
  }),
  Object.freeze({
    value: "lod",
    get label() {
      return tr("Далеко / LOD");
    },
  }),
]);

const FRAMING = Object.freeze({
  overview: { aim: 0.42, span: 1.7, yaw: 0.68, pitch: 0.38 },
  /* Камера внутри навеса и почти на уровне глаз: наклон здесь маленький не
     ради красоты, а потому что сверху навес закрывает сам себя. */
  canopy: { aim: 0.55, span: 0.62, yaw: 2.36, pitch: 0.07 },
  sign: { aim: 0.86, span: 1.05, yaw: 0.2, pitch: 0.22 },
  pumps: { aim: 0.18, span: 0.86, yaw: 1.42, pitch: 0.11 },
  lod: { aim: 0.42, span: 3.4, yaw: 0.68, pitch: 0.3 },
});

const DEFAULT_VIEW = "overview";

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/* ---------- час и экспозиция ---------- */

/*
 * Насколько сейчас сумерки: ноль днём, единица ночью.
 *
 * Свет окна главнее собственного счёта по часу: там высота солнца берётся из
 * настоящих ключевых кадров игры вместе с погодой и широтой. Свой расчёт
 * остаётся на случай окна без неба — стенд, тест, кадр вне экрана.
 *
 * Копия `facadeNightFactor` из `mega-mall-scene.js`, и это осознанная копия, а
 * не недосмотр: импорт оттуда притащил бы в просмотр заправки весь чанк
 * редактора Ашана с его панелями, лучами и разбором щелчков. Общее место для
 * обеих функций — `preview/facade-night.js`, но папка окна принадлежит не этой
 * работе (см. отчёт).
 */
export function buildingNightFactor(hour = 12, lighting = null) {
  if (Number.isFinite(lighting?.daylight)) {
    return clamp(1 - lighting.daylight, 0, 1);
  }
  const numeric = Number.isFinite(Number(hour)) ? Number(hour) : 12;
  const phase = (((numeric % 24) + 24) % 24) - 6;
  return clamp(1 - Math.max(0, Math.sin((phase / 12) * Math.PI)) * 2.6, 0, 1);
}

/*
 * Поправка на экспозицию кадра.
 *
 * Считает её окно и кладёт в кадр: границы поправки выводятся из полного хода
 * экспозиции, а ход знает только окно. Свой потолок здесь подбирать ЗАПРЕЩЕНО —
 * у арены это однажды дало полдень темнее полуночи.
 */
export function buildingExposureGuard(frame) {
  const gain = frame?.interiorGain;
  return gain > 0 ? gain : 1;
}

/*
 * Мокрость покрытия по типу погоды.
 *
 * Осадков в файлах таймцикла нет — игра включает их по типу погоды, и таблица
 * на всю мастерскую одна (`weather/weather-model.js`). Считать её на каждый
 * кадр незачем: тип погоды меняется нажатием, а разбор неба под ним стоит
 * заметно дороже умножения.
 */
const wetCache = new Map();

export function surfaceWetness(weatherId) {
  const id = String(weatherId || "EXTRASUNNY");
  const known = wetCache.get(id);
  if (known !== undefined) return known;
  let wet = 0;
  try {
    const fall = defaultSetup(id).precipitation;
    wet = fall.kind === "rain" ? clamp(fall.amount / 100, 0, 1) : 0;
  } catch {
    /* Неизвестная погода — сухо: выдумывать дождь там, где таймцикл о нём не
       знает, значит показать мокрый асфальт под чистым небом. */
    wet = 0;
  }
  wetCache.set(id, wet);
  return wet;
}

/* ---------- расстановка ---------- */

/*
 * Последовательность R₂ (Roberts, 2018) — та же, что расставляет траву в
 * `vegetation/vegetation-scene.js`. Свойство, ради которого она здесь: любой
 * префикс покрывает круг так же ровно, как весь набор, поэтому уменьшенное по
 * качеству число карточек редеет всюду сразу, а не обрезается сектором.
 */
const PLASTIC = 1.324717957244746;
const R2_X = 1 / PLASTIC;
const R2_Y = 1 / (PLASTIC * PLASTIC);
const fract = (value) => value - Math.floor(value);

function ringPoint(index, inner, outer) {
  const u = fract(0.5 + R2_X * (index + 1));
  const v = fract(0.5 + R2_Y * (index + 1));
  /* Корень — не украшение: без него точки сгущаются к центру, потому что
     площадь кольца растёт с радиусом, а доля индексов — нет. */
  const r = Math.sqrt(inner * inner + u * (outer * outer - inner * inner));
  const angle = v * Math.PI * 2;
  return [Math.cos(angle) * r, Math.sin(angle) * r];
}

/* Свой генератор случайных вместо Math.random: сцена обязана открываться одним
   и тем же кадром, иначе «до» и «после» правки не сравнить глазами. */
function seeded(seed) {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Крест из плоскостей — заготовка одной карточки кустарника.
 *
 * Нормали разведены вбок (`lateral`), иначе плоский прямоугольник ловит свет
 * как стена и куст в кадре читается картонкой.
 */
function crossGeometry(THREE, planes) {
  const geometry = new THREE.BufferGeometry();
  const position = [];
  const uv = [];
  const normal = [];
  const index = [];
  const lateral = 0.75;
  for (let plane = 0; plane < planes; plane += 1) {
    const angle = (Math.PI * plane) / planes;
    const dx = Math.cos(angle) * 0.5;
    const dz = Math.sin(angle) * 0.5;
    const base = plane * 4;
    position.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (const side of [-1, 1, 1, -1]) {
      normal.push(side * dx * 2 * lateral, 1, side * dz * 2 * lateral);
    }
    /* Обратные треугольники дописаны в тот же буфер, а не включены
       `side: DoubleSide`: двусторонний материал отключил бы отсечение задних
       граней для всего меша, а нам нужна только вторая сторона карточки. */
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    index.push(base + 2, base + 1, base, base + 3, base + 2, base);
  }
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(position, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  geometry.normalizeNormals();
  geometry.setIndex(index);
  return geometry;
}

/* ---------- набор текстур окна ---------- */

/**
 * Первое имя, которое в самом деле нашлось в извлечённых текстурах.
 *
 * Спрашиваем именно про наличие, а не про текстуру: неизвестное имя набор
 * подменяет процедурным шумом молча, и отличить «асфальт из игры» от «шум
 * вместо асфальта» по возвращённой текстуре уже нельзя. Ровно на этом стояла
 * ошибка, из-за которой под заправкой никогда не было настоящего покрытия.
 *
 * Вторая копия этой пары в мастерской (первая была у прежнего редактора
 * дорог, снятого 07.10.2026), и её место в `preview/preview-scenery.js`;
 * папка окна принадлежит не этой работе.
 */
function firstAsset(ctx, names) {
  if (typeof ctx?.assets?.find !== "function") return null;
  for (const name of names) {
    try {
      if (ctx.assets.find(name)) return name;
    } catch {
      return null;
    }
  }
  return null;
}

/** Текстура покрытия: из игры, иначе процедурная замена нужного вида. */
function sceneryTexture(ctx, id, kind, repeat) {
  if (typeof ctx?.assets?.texture !== "function") return null;
  try {
    return (
      ctx.assets.texture(id || kind, {
        repeat,
        kind,
        onLoad: () => ctx.requestRender?.(),
      }) || null
    );
  } catch {
    return null;
  }
}

/** Карта нормалей того же покрытия. Её нет — `null`, а не выдуманный рельеф. */
function sceneryNormal(ctx, id, repeat) {
  if (!id || typeof ctx?.assets?.normalTexture !== "function") return null;
  try {
    return (
      ctx.assets.normalTexture(id, {
        repeat,
        onLoad: () => ctx.requestRender?.(),
      }) || null
    );
  } catch {
    return null;
  }
}

/** Сколько метров мира занимает один повтор этого покрытия. */
function tileMetersOf(ctx, id, fallback) {
  if (!id || typeof ctx?.assets?.tileMeters !== "function") return fallback;
  const value = Number(ctx.assets.tileMeters(id));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/* ---------- уборка ---------- */

/** Освобождение чужого дерева: модель из игры приходит со своими материалами. */
function releaseTree(root) {
  root?.traverse?.((object) => {
    object.geometry?.dispose?.();
    const material = object.material;
    if (Array.isArray(material))
      material.forEach((entry) => entry?.dispose?.());
    else material?.dispose?.();
  });
}

/**
 * Сцена одного здания по контракту окна превью.
 *
 * `onModel` сообщает наружу, что стало с моделью, `onScene` — что оказалось в
 * кадре настоящего: без первого экран не отличит «читаем из игры» от «игры
 * нет», без второго не сможет честно подписать, что в кадре от Rockstar, а что
 * нарисовано кодом.
 */
export function createBuildingScene({
  buildingId = "",
  onModel = null,
  onScene = null,
} = {}) {
  let ctx = null;
  let THREE = null;
  let root = null;

  let terrain = null;
  let terrainMaterial = null;
  let terrainGeometry = null;
  let terrainTile = 4;
  let terrainBase = null;

  let forecourt = null;
  let forecourtMaterial = null;
  let forecourtGeometry = null;
  let forecourtTile = 8;
  let forecourtBase = null;
  let forecourtRadius = FORECOURT_RANGE[0];

  let scrub = null;
  let scrubMaterial = null;
  let scrubGeometry = null;

  let model = null;
  let modelOffset = null;
  /* Лампы навеса: сам источник, его цель (у конуса), базовая яркость в канделах
     и маска часов из игры. */
  let lamps = [];
  /* Материалы модели, которым игра назначила эмиссионный шейдер, и их
     собственная сила свечения из GLB. */
  let glowing = [];

  let radius = 0;
  let height = 0;
  let view = DEFAULT_VIEW;
  let mounted = false;
  let generation = 0;
  /* Отпечаток последнего покрашенного кадра: час, погода и дальность тумана
     меняются нажатием, а не каждый кадр, и перекрашивать по десятку материалов
     на неподвижной картинке незачем. */
  let paintKey = "";

  const report = () => {
    onScene?.({
      source: ctx?.assets?.source === "game" ? "game" : "fallback",
      forecourt: Boolean(forecourtBase?.id),
      terrain: Boolean(terrainBase?.id),
      scrub: Boolean(scrub),
      lamps: lamps.length,
      glowing: glowing.length,
    });
  };

  /**
   * Ракурс.
   *
   * Пределы орбиты сцена задаёт свои: без них колесо уводит камеру внутрь
   * навеса и наружу за туман, а возвращать её руками в `update` вредно — драка
   * с собственным вводом даёт пружинящую камеру.
   */
  function applyCamera() {
    if (!ctx?.setOrbit) return;
    const framing = FRAMING[view] || FRAMING[DEFAULT_VIEW];
    const span = radius || 24;
    const aim = height ? height * framing.aim : span * 0.4;
    ctx.setOrbit({
      target: [0, aim, 0],
      radius: span * framing.span,
      yaw: framing.yaw,
      pitch: framing.pitch,
      minRadius: span * 0.34,
      maxRadius: span * 5.2,
      minPitch: 0.04,
      maxPitch: 1.15,
    });
  }

  /* ---------- земля ---------- */

  function buildGround(context) {
    /*
     * Форкорт и земля вокруг — два разных покрытия, а не одно.
     *
     * Раньше здесь лежал один асфальтовый диск в четыреста двадцать метров:
     * заправка стояла посреди бесконечной парковки, которой в игре нет. Теперь
     * асфальт кончается там же, где кончается площадка станции, а дальше идёт
     * грунт до самого тумана.
     */
    const forecourtId = firstAsset(context, FORECOURT_IDS);
    forecourtTile = tileMetersOf(context, forecourtId, 8);
    const forecourtMap = sceneryTexture(context, forecourtId, "asphalt", 1);
    const forecourtNormal = sceneryNormal(context, forecourtId, 1);
    forecourtBase = {
      id: forecourtId,
      /* Покрытие покрашено до нас: у асфальта своя яркость, и второй слой
         краски поверх него превращает площадку в чёрную дыру под зданием.
         Цвет остаётся там, где текстуры не легло ВООБЩЕ — а не там, где не
         нашлось игры: `sceneryTexture` отдаёт процедурную замену и без неё,
         и с прежним условием по `forecourtId` запасной путь красил тёмным
         поверх и без того тёмного асфальта. Итоговое альбедо выходило 0.009
         при натурных 0.1, и площадка была чёрной даже в полдень. */
      colour: new THREE.Color(forecourtMap ? 0xffffff : 0x6a6d70),
    };
    /* Диск единичного радиуса: размер задаётся масштабом меша, а не
       геометрией, — площадку надо подогнать под габарит модели, когда она
       приедет, и пересобирать ради этого буфер вершин незачем. */
    forecourtGeometry = new THREE.CircleGeometry(1, 72);
    forecourtMaterial = new THREE.MeshStandardMaterial({
      color: forecourtBase.colour.clone(),
      roughness: 0.96,
      map: forecourtMap || null,
      normalMap: forecourtNormal || null,
    });
    forecourt = new THREE.Mesh(forecourtGeometry, forecourtMaterial);
    forecourt.name = "building-forecourt";
    forecourt.rotation.x = -Math.PI / 2;
    forecourt.position.y = -0.04;
    forecourt.receiveShadow = true;
    root.add(forecourt);

    const terrainId = firstAsset(context, TERRAIN_IDS);
    terrainTile = tileMetersOf(context, terrainId, 4);
    const terrainMap = sceneryTexture(context, terrainId, "dirt", 1);
    const terrainNormal = sceneryNormal(context, terrainId, 1);
    terrainBase = {
      id: terrainId,
      /* То же, что и у форкорта: красим только голую геометрию. */
      colour: new THREE.Color(terrainMap ? 0xffffff : 0x6b5b46),
    };
    terrainGeometry = new THREE.CircleGeometry(1, 96);
    terrainMaterial = new THREE.MeshStandardMaterial({
      color: terrainBase.colour.clone(),
      roughness: 1,
      map: terrainMap || null,
      normalMap: terrainNormal || null,
    });
    terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.name = "building-terrain";
    terrain.rotation.x = -Math.PI / 2;
    /* Ниже форкорта на четыре сантиметра: два соплана в одной плоскости дают
       мерцающий шов по краю площадки на каждом движении камеры. */
    terrain.position.y = -0.08;
    terrain.receiveShadow = true;
    /* Габарит считается по единичному диску, а масштаб уводит край за туман:
       без этого земля исчезает целиком, стоит центру уйти за край экрана. */
    terrain.frustumCulled = false;
    root.add(terrain);
  }

  /**
   * Размер земли — по дальности тумана ЭТОГО кадра.
   *
   * Дальность гуляет по часу и погоде (`preview-stage.js`, `applyLighting`),
   * поэтому она читается каждый кадр, а не один раз при монтаже. Земля короче
   * тумана — тёмный шов по горизонту; длиннее — километры ровной заливки,
   * которые едят глубину и карту теней.
   *
   * Меняются только масштаб меша и повтор развёртки. Повтор — это матрица
   * развёртки, а не содержимое: перезаливки текстуры здесь нет.
   */
  function layoutGround(far) {
    if (terrain) {
      terrain.scale.set(far, far, 1);
      const tiles = (far * 2) / terrainTile;
      terrainMaterial.map?.repeat?.set(tiles, tiles);
      terrainMaterial.normalMap?.repeat?.set(tiles, tiles);
    }
    if (forecourt) {
      forecourt.scale.set(forecourtRadius, forecourtRadius, 1);
      const tiles = (forecourtRadius * 2) / forecourtTile;
      forecourtMaterial.map?.repeat?.set(tiles, tiles);
      forecourtMaterial.normalMap?.repeat?.set(tiles, tiles);
    }
  }

  /**
   * Пояс кустарника за форкортом.
   *
   * Один `InstancedMesh` на весь пояс: тысячи отдельных мешей стоили бы тысячи
   * вызовов отрисовки. Матрицы считаются ОДИН раз — здесь; ничто в сцене их
   * потом не двигает.
   *
   * Без настоящей текстуры пояс не строится вовсе, и это не отказ от работы:
   * форма растения живёт в альфе, а у процедурной замены альфы нет — с
   * альфа-тестом получилось бы поле непрозрачных прямоугольников, которое
   * выглядит хуже пустой земли.
   */
  function buildScrub(context, inner) {
    const id = firstAsset(context, SCRUB_IDS);
    if (!id) return;
    const quality = context.quality || "medium";
    const count = SCRUB_COUNT[quality] ?? SCRUB_COUNT.medium;
    if (!count) return;
    const outer = Math.max(inner + 12, SCRUB_REACH);
    const map = sceneryTexture(context, id, "grass", 1);
    if (!map) return;

    scrubGeometry = crossGeometry(THREE, SCRUB_PLANES);
    scrubMaterial = new THREE.MeshLambertMaterial({
      /* Ламберт, а не «стандартный»: у сухой травы нет ни бликов, ни металла,
         а разница в цене на тысячах экземпляров — это разница между окном и
         слайд-шоу. */
      map,
      alphaTest: ALPHA_TEST,
      /* Непрозрачный материал с альфа-тестом, а не `transparent`:
         полупрозрачность потребовала бы сортировки тысяч карточек по глубине
         каждый кадр. */
      transparent: false,
      side: THREE.FrontSide,
    });
    scrub = new THREE.InstancedMesh(scrubGeometry, scrubMaterial, count);
    scrub.name = "building-scrub";
    /* Габарит `InstancedMesh` считается по заготовке, а не по расставленным
       экземплярам: с отсечением пояс пропадал бы целиком. */
    scrub.frustumCulled = false;
    /* Тени кустарник не бросает: карта теней одна на сцену, и тысячи карточек
       в ней съели бы разрешение, которое нужно самой станции. */
    scrub.castShadow = false;
    scrub.receiveShadow = true;

    const random = seeded(0x9e37);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    const width = tileMetersOf(context, id, 1.1);
    for (let index = 0; index < count; index += 1) {
      const [x, z] = ringPoint(index, inner, outer);
      /* Ближе к асфальту трава реже и ниже — там её вытаптывают и жгут
         выхлопом; это заметнее любой расстановки по кругу. */
      const edge = clamp((Math.hypot(x, z) - inner) / 14, 0, 1);
      const size = width * (0.55 + random() * 0.7) * (0.45 + edge * 0.55);
      position.set(x, -0.05, z);
      rotation.setFromAxisAngle(axis, random() * Math.PI * 2);
      scale.set(size, size * (0.8 + random() * 0.5), size);
      matrix.compose(position, rotation, scale);
      scrub.setMatrixAt(index, matrix);
    }
    scrub.instanceMatrix.needsUpdate = true;
    root.add(scrub);
  }

  /* ---------- модель ---------- */

  /**
   * Анизотропия текстурам модели.
   *
   * GLTFLoader отдаёт текстуры с анизотропией единица, а покрытие форкорта и
   * стены станции видно под скользящим углом почти всегда: без этого асфальт
   * модели в двадцати метрах превращается в мыло, пока набор окна рядом стоит
   * чётким. Число берётся у рендерера, а не назначается: потолок у видеокарт
   * разный.
   */
  function sharpenTextures(material) {
    const capable = ctx?.renderer?.capabilities?.getMaxAnisotropy?.();
    const quality = ctx?.quality || "medium";
    const wanted = quality === "low" ? 1 : quality === "high" ? 8 : 4;
    const anisotropy = Math.min(Number(capable) || 1, wanted);
    if (anisotropy <= 1) return;
    for (const value of Object.values(material)) {
      if (!value?.isTexture || value.anisotropy === anisotropy) continue;
      value.anisotropy = anisotropy;
      value.needsUpdate = true;
    }
  }

  /**
   * Материалы, которым игра назначила эмиссионный шейдер.
   *
   * Искать вывеску по ИМЕНАМ материалов нельзя, и это проверено по коду
   * конвертера: он называет материалы `Mat_<номер>`
   * (нативный конвертер Astral, `new MaterialBuilder("Mat_" + i)`), имена
   * игры в GLB не доезжают вовсе.
   * Зато доезжает главное: у шейдеров из списка `EmissiveShaders` — а это
   * `emissivenight` и вся его родня, тот же шейдер, которым горит вывеска в
   * самой игре, — конвертер подключает эмиссионный канал с диффузной картой.
   * То есть отметка «это светится» уже стоит в модели, и её надо не угадать, а
   * прочитать.
   *
   * Своей силы свечения мы не назначаем: она приходит из GLB
   * (`KHR_materials_emissive_strength`) и служит основанием, к которому
   * добавляется ночная надбавка.
   */
  function collectGlowing(next) {
    const seen = new Set();
    const found = [];
    next.traverse((object) => {
      if (!object.isMesh) return;
      const list = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of list) {
        if (!material || seen.has(material)) continue;
        seen.add(material);
        sharpenTextures(material);
        const emissive = material.emissive;
        if (!emissive) continue;
        const lit =
          Boolean(material.emissiveMap) ||
          emissive.r > 0 ||
          emissive.g > 0 ||
          emissive.b > 0;
        if (!lit) continue;
        found.push({
          material,
          base: Number.isFinite(material.emissiveIntensity)
            ? material.emissiveIntensity
            : 1,
        });
      }
    });
    return found;
  }

  /**
   * Лампы модели из её LightAttributes.
   *
   * Это единственный кадр в мастерской, где искусственный свет взят из данных
   * игры целиком: позиция, цвет, яркость, дальность, показатель затухания и
   * угол конуса — всё авторское. Подбирать здесь нечего и не нужно.
   *
   * Лампы сдвигаются тем же смещением, что и модель: иначе свет повиснет
   * отдельно от навеса, под которым он должен гореть.
   */
  function buildLamps(list, offset) {
    const quality = ctx?.quality || "medium";
    const budget = LAMP_BUDGET[quality] ?? LAMP_BUDGET.medium;
    const ranked = [...list]
      .filter((light) => light?.position)
      /* Самые яркие вперёд: остальные добавляют к освещённости доли процента,
         а стоят ровно столько же — ещё один проход по всем материалам. */
      .sort((a, b) => (Number(b.intensity) || 0) - (Number(a.intensity) || 0))
      .slice(0, budget);

    for (const light of ranked) {
      const position = new THREE.Vector3(
        light.position.x,
        light.position.y,
        light.position.z,
      ).sub(offset);
      const colour = new THREE.Color();
      /* Цвет игра хранит байтами sRGB — тем же пространством, в котором его
         читает редактор фонарей. Положить их как линейные значило бы получить
         натриевую лампу цвета лимона. */
      colour.setRGB(
        (Number(light.color?.r) || 255) / 255,
        (Number(light.color?.g) || 255) / 255,
        (Number(light.color?.b) || 255) / 255,
        THREE.SRGBColorSpace,
      );

      const falloff = Number(light.falloff) || 0;
      const distance = falloff > 0.5 ? falloff : clamp(radius * 0.6, 6, 40);
      /* Показатель затухания игра держит в своей шкале; перевод тот же, что у
         фонарей, — иначе одна и та же лампа светила бы в двух окнах по-разному. */
      const decay = Math.max(0.5, (Number(light.falloffExponent) || 0) / 64);
      const candela = Math.max(0, Number(light.intensity) || 0) * LAMP_CANDELA;

      let source = null;
      let target = null;
      if (String(light.type) === "spot") {
        /* Угол конуса игра пишет в градусах. Ноль и всё, что вылезло за
           прямой угол, — это не конус, а испорченное поле: такой лампе даём
           широкий рассеянный конус вместо луча в никуда. */
        const outer = Number(light.coneOuterAngle) || 0;
        const angle =
          outer > 1 && outer < 90
            ? (outer * Math.PI) / 180
            : (60 * Math.PI) / 180;
        const inner = Number(light.coneInnerAngle) || 0;
        /* Мягкость края — это отношение внутреннего конуса к внешнему, а не
           подобранное число: у прожектора края резкие, у плафона размытые. */
        const penumbra =
          inner > 0 && inner < outer ? clamp(1 - inner / outer, 0.05, 1) : 0.45;
        const spot = new THREE.SpotLight(colour, 0, distance, angle, penumbra);
        spot.decay = decay;
        target = new THREE.Object3D();
        const direction = new THREE.Vector3(
          Number(light.direction?.x) || 0,
          Number(light.direction?.y) || -1,
          Number(light.direction?.z) || 0,
        );
        if (direction.lengthSq() < 1e-6) direction.set(0, -1, 0);
        target.position
          .copy(position)
          .add(direction.normalize().multiplyScalar(Math.max(2, distance)));
        target.name = "building-lamp-aim";
        /* Цель обязана лежать в сцене, иначе конус отстаёт на кадр. */
        root.add(target);
        spot.target = target;
        source = spot;
      } else {
        source = new THREE.PointLight(colour, 0, distance, decay);
      }

      source.name = "building-lamp";
      source.position.copy(position);
      /* Тени только у солнца. Каждая тень — отдельный проход карты теней, а
         ламп под навесом может быть два десятка. */
      source.castShadow = false;
      source.visible = false;
      root.add(source);
      lamps.push({
        source,
        target,
        candela,
        /* Битовая маска часов, в которые лампа горит в игре. Ноль означает «в
           ресурсе не заполнено», а не «не горит никогда». */
        timeFlags: Number(light.timeFlags) || 0,
      });
    }
  }

  function attach(next, lights) {
    /* У карт GTA координаты мировые: без переноса здание оказалось бы в
       километрах от камеры. Ставим его в центр и на землю. */
    const bounds = new THREE.Box3().setFromObject(next);
    const centre = bounds.getCenter(new THREE.Vector3());
    const extent = bounds.getSize(new THREE.Vector3());
    modelOffset = new THREE.Vector3(centre.x, bounds.min.y, centre.z);
    next.position.sub(modelOffset);
    next.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    root.add(next);
    model = next;

    radius = Math.max(extent.x, extent.y, extent.z) / 2;
    height = extent.y;

    glowing = collectGlowing(next);
    buildLamps(Array.isArray(lights) ? lights : [], modelOffset);

    /* Площадка под станцию, а не под квартал: асфальт кончается там, где
       кончается сама заправка, и дальше идёт грунт. */
    forecourtRadius = clamp(radius * FORECOURT_SPAN, ...FORECOURT_RANGE);
    buildScrub(ctx, forecourtRadius + 1.5);

    /* Коробку теней и туман подгоняем под саму модель: коробка на квартал
       даёт тень-лесенку, а туман под квартал обрубает комплекс. */
    ctx?.setShadowExtent?.(clamp(radius * 1.6, 24, 480));
    ctx?.setFogRange?.(Math.max(12, radius * 0.6), Math.max(220, radius * 9));
    applyCamera();
    /* Отпечаток сбрасываем: в сцене появились лампы и свечение, и следующий
       кадр обязан их покрасить, даже если час и погода не менялись. */
    paintKey = "";
    onModel?.({ status: "ready", reason: "" });
    report();
    ctx?.requestRender?.();
  }

  /**
   * Модель едет из игры асинхронно, а окно вправе закрыться раньше.
   *
   * Поколение сверяется после каждого ожидания: осевшая в мёртвой сцене
   * геометрия не видна никому и не освобождается никем.
   */
  function load() {
    const mine = generation;
    const alive = () => mounted && generation === mine;

    /* Без приложения под окном читать нечего — и решается это синхронно:
       уходить в асинхронность ради заведомого «недоступно» значит получить
       ответ уже после закрытия. */
    if (!hasDesktopBridge()) {
      onModel?.({
        status: "unavailable",
        reason: tr("Модель из игры читается только в Astral Desktop."),
      });
      return;
    }

    const failed = (reason) => {
      if (!alive()) return;
      onModel?.({ status: "unavailable", reason });
    };

    onModel?.({ status: "loading", reason: "" });
    loadMegaMallBuildingModel({ buildingId })
      .then((result) => {
        if (!alive()) return;
        if (result?.status !== "ready" || !result.glb) {
          failed(String(result?.reason || tr("Модель из игры недоступна.")));
          return;
        }
        new GLTFLoader().parse(
          result.glb,
          "",
          (gltf) => {
            if (!alive()) {
              releaseTree(gltf.scene);
              return;
            }
            attach(gltf.scene, result.lights);
          },
          () => failed(tr("Модель не разобралась загрузчиком GLB.")),
        );
      })
      .catch((error) => failed(String(error?.message || error)));
  }

  return {
    /* Здание стоит под открытым небом: экспозицию окно ключует по небу. */
    enclosed: false,
    camera: "orbit",

    mount(context) {
      ctx = context;
      THREE = context.THREE;
      generation += 1;

      root = new THREE.Group();
      root.name = "building-preview";
      context.scene.add(root);

      buildGround(context);

      context.setShadowExtent?.(90);
      context.setFogRange?.(20, 420);
      layoutGround(context.fog?.far || 420);
      applyCamera();

      mounted = true;
      report();
      load();
    },

    /**
     * Кадр: час, погода и дальность тумана.
     *
     * Раньше здесь было пусто, и это было честно ровно до тех пор, пока в
     * сцене не появилось ничего своего. Теперь есть: свет ламп, свечение
     * вывески, мокрое покрытие и размер земли.
     *
     * Кадров отсюда НЕ просим. Окно зовёт `update` только тогда, когда само
     * собирается рисовать; попросить кадр здесь значит попросить следующий,
     * и просмотр заправки закрутил бы цикл шестьдесят раз в секунду там, где
     * раньше стоял ноль.
     */
    update(context, frame) {
      if (!mounted) return;
      const hour = Number.isFinite(Number(frame?.timeOfDay))
        ? Number(frame.timeOfDay)
        : 12;
      const night = buildingNightFactor(hour, frame?.lighting);
      const guard = buildingExposureGuard(frame);
      const wet = surfaceWetness(frame?.lighting?.weather);
      const far = Math.max(40, Number(context?.fog?.far) || 420);

      const key = [
        Math.round(night * 1000),
        Math.round(guard * 1000),
        Math.round(wet * 1000),
        Math.round(far),
        Math.round(forecourtRadius),
        Math.floor(hour),
      ].join("|");
      if (key === paintKey) return;
      paintKey = key;

      layoutGround(far);

      /*
       * Мокрое покрытие — одна правка, а не три: асфальт после дождя темнеет,
       * перестаёт рассеивать и начинает отражать. Отражать ему при этом нечего
       * — карты окружения в сцене нет, — поэтому мокрость читается бликом ОТ
       * ламп навеса, и без них она была бы просто тёмным пятном.
       *
       * Цвет каждый раз берётся от основания, а не домножается на прошлый:
       * иначе покрытие уходит в чёрное за десяток кадров.
       */
      if (forecourtMaterial) {
        forecourtMaterial.color
          .copy(forecourtBase.colour)
          .multiplyScalar(1 - wet * 0.34);
        forecourtMaterial.roughness = 0.96 - wet * 0.72;
        forecourtMaterial.metalness = wet * 0.34;
      }
      if (terrainMaterial) {
        /* Грунт мокнет не так, как асфальт: он впитывает. Темнеет заметно,
           блестит едва. */
        terrainMaterial.color
          .copy(terrainBase.colour)
          .multiplyScalar(1 - wet * 0.22);
        terrainMaterial.roughness = 1 - wet * 0.24;
      }

      /*
       * Лампы навеса.
       *
       * Яркость делится на выбранный окном множитель кадра: искусственный свет
       * от солнца не зависит и в кадре обязан гореть одинаково при любой
       * экспозиции. Собственного потолка у поправки здесь нет намеренно — её
       * границы выводит окно из полного хода экспозиции.
       */
      const slot = Math.floor(((hour % 24) + 24) % 24);
      for (const lamp of lamps) {
        const scheduled =
          lamp.timeFlags === 0 || ((lamp.timeFlags >>> slot) & 1) === 1;
        const intensity = scheduled ? lamp.candela * night * guard : 0;
        lamp.source.intensity = intensity;
        /* Погашенный источник убираем из кадра совсем: лампа с нулевой
           яркостью — это всё равно ещё один проход по всем материалам. */
        lamp.source.visible = intensity > 0.5;
      }

      /*
       * Свечение вывески и плафонов.
       *
       * Основание — то, что назначила сама игра через шейдер; ночью к нему
       * добавляется надбавка с поправкой на экспозицию. Днём остаётся ровно
       * основание: эмиссионная поверхность в полдень — это яркая краска, а не
       * фонарь, и раздувать её значит показать светящуюся вывеску там, где в
       * игре её не видно.
       */
      for (const entry of glowing) {
        entry.material.emissiveIntensity =
          entry.base * (1 + night * SIGN_GLOW * guard);
      }
    },

    dispose() {
      mounted = false;
      generation += 1;

      for (const lamp of lamps) {
        root?.remove(lamp.source);
        lamp.source.dispose?.();
        if (lamp.target) root?.remove(lamp.target);
      }
      lamps = [];
      glowing = [];

      if (model) {
        root?.remove(model);
        releaseTree(model);
        model = null;
      }
      if (scrub) {
        root?.remove(scrub);
        /* `InstancedMesh` освобождается ЯВНО: без этого буфер матриц
           экземпляров остаётся в видеопамяти — обход дерева его не находит. */
        scrub.dispose?.();
        scrub = null;
      }
      if (root) ctx?.scene?.remove?.(root);

      scrubGeometry?.dispose?.();
      scrubMaterial?.dispose?.();
      forecourtGeometry?.dispose?.();
      forecourtMaterial?.dispose?.();
      terrainGeometry?.dispose?.();
      terrainMaterial?.dispose?.();
      /* Текстуры НЕ трогаем: они принадлежат набору окна и освобождаются им.
         Материалы модели снял `releaseTree` выше. */
      scrubGeometry = null;
      scrubMaterial = null;
      forecourtGeometry = null;
      forecourtMaterial = null;
      forecourt = null;
      forecourtBase = null;
      terrainGeometry = null;
      terrainMaterial = null;
      terrain = null;
      terrainBase = null;
      modelOffset = null;
      root = null;
      radius = 0;
      height = 0;
      paintKey = "";
      ctx = null;
    },

    /** Ракурс из `BUILDING_VIEWS`. */
    setView(next) {
      view = FRAMING[next] ? next : DEFAULT_VIEW;
      applyCamera();
    },
  };
}
