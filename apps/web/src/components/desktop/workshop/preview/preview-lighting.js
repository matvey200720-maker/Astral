/*
 * Свет кадра из таймцикла GTA.
 *
 * Здесь нет ни одной подобранной «на глаз» константы цвета: и солнце, и
 * ambient, и туман, и экспозиция берутся из `@modovik/timecycle` — того же
 * пакета, по которому редактор неба показывает своё небо. Иначе дорога и арена
 * жили бы в собственных сумерках, не совпадающих ни с игрой, ни с редактором
 * неба, и «проверить закат» означало бы проверить три разных заката.
 *
 * Модуль намеренно не знает про three.js: он отдаёт числа. Так его можно
 * посчитать в тесте без WebGL — а тест на то, что смена часа меняет свет,
 * иначе пришлось бы писать через мок графики.
 */

import {
  SCENE_LIGHT,
  autoExposureStops,
  findWeather,
  referenceKeyframeDocument,
  resolveSkyState,
  tonemapPreview,
} from "@modovik/timecycle";

/*
 * Эталонный документ строится из четырёхсот параметров на тринадцать кадров и
 * два региона — это заметная работа, а погоду в окне меняют кнопкой. Собираем
 * один раз на тип погоды: за сутки предпросмотра документ не меняется вовсе,
 * меняется только час, по которому из него читают.
 */
const baselines = new Map();

export function baselineDocument(weather) {
  const id = findWeather(weather)?.id || "EXTRASUNNY";
  let document = baselines.get(id);
  if (!document) {
    document = referenceKeyframeDocument(id);
    baselines.set(id, document);
  }
  return document;
}

export const normalizeHour = (value) => {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return 12;
  return ((hour % 24) + 24) % 24;
};

/*
 * GTA держит мир в правой системе с осью Z вверх, three — с осью Y вверх.
 * Пересчёт живёт в одном месте: перепутать здесь знак означает солнце,
 * встающее на западе, и туман, который светится не с той стороны.
 */
export const toStageDirection = (vector) => [
  vector?.x ?? 0,
  vector?.z ?? 0,
  -(vector?.y ?? 0),
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const peakOf = (rgb) => Math.max(rgb[0], rgb[1], rgb[2], 1e-4);

/*
 * Яркость света и экспозиция обязаны считаться по одной модели.
 *
 * `autoExposureStops` из пакета исходит из того, что земля освещена как
 * `ambient * SCENE_LIGHT.ambient * 0.5 + direct * SCENE_LIGHT.direct`. Если
 * лампы three выставить в других единицах, экспозиция будет подобрана не для
 * той картинки, которую показывают: полдень уйдёт в белое, ночь — в угольное.
 * Поэтому обе лампы масштабируются ровно теми же множителями, а лишняя `π`
 * — это ламбертовский `1/π` в BRDF three, который иначе съел бы всю яркость.
 */
const LAMBERT = Math.PI;
const SUN_GAIN = SCENE_LIGHT.direct * LAMBERT;
const AMBIENT_GAIN = SCENE_LIGHT.ambient * 0.5 * LAMBERT;

/*
 * Плёночная кривая three (`ACESFilmicToneMapping`) делит вход на 0.6, прежде
 * чем свести кадр, а `autoExposureStops` считает стопы для кривой без этого
 * деления. Множитель возвращает их в одну шкалу — без него весь предпросмотр
 * оказывается на две трети стопа светлее, чем полоса времени под ним.
 */
export const ACES_EXPOSURE_MATCH = 0.6;

/*
 * Потолок ночного подъёма экспозиции.
 *
 * `autoExposureStops` считает экспозицию для кадра, который почти целиком небо:
 * там ночь поднимают на три с половиной стопа, иначе её нечем править — она
 * честно почти чёрная. Здесь кадр другой: земля, дорога, трибуны, и тот же
 * подъём в двенадцать раз превращает полночь в пасмурный полдень. Ровно то,
 * ради проверки чего окно и открывают — «как это выглядит ночью» — перестаёт
 * работать. Потолок оставляет ночь ночью: горизонт различим, зенит тёмный,
 * земля читается силуэтами.
 */
export const NIGHT_EXPOSURE_CEILING = 1.6;

/*
 * Диапазон экспозиции для закрытой сцены.
 *
 * Формула таймцикла ключуется по небу — на две трети кадра там небо. В зале
 * арены неба не видно вовсе, и яркое полуденное небо роняло экспозицию так,
 * что трибуны становились чернее, чем ночью: реакция на время суток
 * переворачивалась. Закрытая сцена ключуется по свету, который до неё
 * доходит, — по ambient, — а диапазон зажат, чтобы дневной зал не проваливался
 * в темноту, а ночной не выбеливался.
 */
export const ENCLOSED_EXPOSURE_RANGE = Object.freeze([-1.8, 0]);

/*
 * Запас на то, что ложится поверх ключа: собственная экспозиция таймцикла
 * (`postfx_exposure`) и ручка человека. Два стопа в каждую сторону — заведомо
 * больше, чем они дают вместе, поэтому ограничитель усиления ниже никогда не
 * срабатывает внутри рабочего хода. Ровно этим он и отличается от потолков,
 * которые сцены подбирали руками: те срабатывали в полдень.
 */
const INTERIOR_GAIN_HEADROOM = 2;

/*
 * Полный ход экспозиции окна — по нему и считаются границы усиления.
 *
 * Считать их по одному лишь диапазону закрытых сцен было ошибкой: под открытым
 * небом экспозиция уходит куда ниже. У фасада торгового центра в полдень она
 * падает до 0.039, а нижняя граница, выведенная из `enclosed`, стояла на
 * 0.043 — то есть ограничитель срабатывал в обычный полдень обычной сцены.
 * Ровно то, чем были плохи подобранные потолки, только этажом выше.
 *
 * Нижний край — из `autoExposureStops` пакета таймцикла, он зажимает стопы
 * пятёркой вниз; верхний — наш же ночной потолок. Диапазон закрытых сцен в
 * этот ход целиком укладывается.
 */
const EXPOSURE_STOPS_FLOOR = -5;

/**
 * Усиление искусственного света под крышей.
 *
 * Свет зала обязан гореть в кадре одинаково при любой экспозиции, какую бы
 * окно ни выбрало по небу: лампа не тускнеет оттого, что на улице полдень.
 * Раньше этот множитель считала каждая закрытая сцена сама — «единица делить
 * на экспозицию», зажатая потолком, который подбирали на глаз. Потолок
 * срабатывал ровно в полдень, лампы недосвечивали, и сутки переворачивались:
 * закат выходил ярче полудня.
 *
 * Теперь его считает окно, потому что диапазон экспозиции знает только окно.
 * Границы выводятся из этого диапазона, а не назначаются, поэтому ограничитель
 * не может сработать в рабочем ходу — он ловит только бессмысленные значения,
 * какие даёт разве что `fixed` с диким числом.
 */
export function interiorGainFor(toneMappingExposure) {
  const low =
    2 ** (EXPOSURE_STOPS_FLOOR - INTERIOR_GAIN_HEADROOM) * ACES_EXPOSURE_MATCH;
  const high =
    2 ** (NIGHT_EXPOSURE_CEILING + INTERIOR_GAIN_HEADROOM) *
    ACES_EXPOSURE_MATCH;
  const exposure = Math.min(
    Math.max(Number(toneMappingExposure) || high, low),
    high,
  );
  return 1 / exposure;
}

const luminance = (colour) =>
  colour[0] * 0.2126 + colour[1] * 0.7152 + colour[2] * 0.0722;

/**
 * Экспозиция закрытой сцены: по рассеянному свету, без неба и без солнца.
 * Солнце сюда не входит намеренно — под крышу оно не светит, а ключевать
 * интерьер по нему значит гасить его ровно в полдень.
 */
function enclosedExposureStops(sky) {
  const ambient =
    luminance(sky.ambientUpColour) * Math.max(sky.ambientUpIntensity, 0) +
    luminance(sky.ambientDownColour) * Math.max(sky.ambientDownIntensity, 0);
  const key =
    ambient * 0.5 * SCENE_LIGHT.ambient * SCENE_LIGHT.albedo +
    /* Пол под ногами всё равно чем-то освещён — собственными лампами зала,
       про которые окно не знает. Без нижней границы пустая ночь уводила бы
       экспозицию в потолок. */
    0.02;
  const stops = Math.log2(0.28 / Math.max(key, 1e-4)) * 0.85;
  return Math.min(
    Math.max(stops, ENCLOSED_EXPOSURE_RANGE[0]),
    ENCLOSED_EXPOSURE_RANGE[1],
  );
}

/*
 * Дальность тумана. В таймцикле она задана плотностью (`fog_density` уходит за
 * два десятка, `fog_haze_density` держится около четырёх), а three хочет
 * ближнюю и дальнюю границы в метрах. Переводим плотность в множитель к
 * базовой дальности сцены: у арены мир — сто метров, у дороги — несколько
 * сотен, и одна абсолютная дальность на оба случая не годится.
 */
export function fogFalloff(sky) {
  const density = clamp((sky.fogDensity || 0) / 24, 0, 2.2);
  const haze = clamp((sky.fogHazeDensity || 0) / 5, 0, 2.2);
  return clamp(1 / (0.34 + density * 0.62 + haze * 0.5), 0.28, 2.6);
}

/*
 * Цвет тумана в экранных числах.
 *
 * Туман в three накладывается ПОСЛЕ плёночной кривой и после перевода в sRGB —
 * `fog_fragment` стоит в шейдере ниже `tonemapping_fragment`. Значит в его
 * униформу должен приходить уже сведённый цвет, а не линейный HDR: линейный
 * цвет тумана в сумерках уходит за двойку, а смешивать двойку с картинкой,
 * которая уже лежит в диапазоне 0…1, — это упереть весь дальний план в белое.
 * Ровно так по горизонту и шла белая полоса.
 *
 * Кривая повторяет ту, что применяет рендерер: масштаб экспозиции, плёночная
 * кривая, перевод sRGB. Иначе земля у горизонта и купол над ней сойдутся не в
 * один цвет, и на их стыке появится шов — уже не белый, но заметный.
 */
const SRGB_TRANSFER = (value) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

export function displayFogColour(linear, exposureStops) {
  const gain = 2 ** exposureStops;
  return linear.map((channel) => {
    const value = Math.max(channel * gain, 0);
    const mapped =
      (value * (2.51 * value + 0.03)) / (value * (2.43 * value + 0.59) + 0.14);
    return SRGB_TRANSFER(Math.min(Math.max(mapped, 0), 1));
  });
}

/**
 * Состояние света и неба на конкретный час.
 *
 * `document`/`project` оставлены снаружи специально: когда редактор дороги
 * научится показывать небо самого игрока, сюда придёт его разобранный
 * `w_*.xml`, и ни один вызывающий код менять не придётся.
 */
export function previewLighting({
  timeOfDay = 12,
  weather = "EXTRASUNNY",
  region = "GLOBAL",
  document = null,
  project = null,
  exposureBias = 0,
  /*
   * По чему выставлять экспозицию: `sky` — по небу (улица, дорога), `enclosed`
   * — по рассеянному свету (зал, интерьер), `fixed` — по числу, которое задал
   * редактор, потому что он один знает про собственные лампы сцены.
   */
  exposureMode = "sky",
  exposureStops: fixedStops = 0,
} = {}) {
  const hour = normalizeHour(timeOfDay);
  const sky = resolveSkyState({
    document: document || baselineDocument(weather),
    project,
    weather,
    region,
    hour,
  });

  const sunUp = clamp(sky.sunDirection?.z ?? 0, -1, 1);
  const daylight = clamp((sunUp + 0.12) / 0.32, 0, 1);

  /*
   * Ключевой свет один, и он переезжает с солнца на луну.
   *
   * Держать две направленные лампы и гасить одну дешевле по коду, но дороже по
   * кадру: каждая лампа с тенью — это ещё один проход карты теней, и ночью он
   * рисуется впустую. Ночью светит луна, днём — солнце, между ними — плавный
   * переход по высоте солнца, а не по часу: иначе в пасмурную погоду свет
   * щёлкает ровно в 18:00, когда за окном ничего не происходит.
   */
  const sunColour = sky.lightDirColour;
  const sunPeak = peakOf(sunColour);
  const sunIntensity =
    Math.max(sky.lightDirIntensity, 0) * SUN_GAIN * daylight * sunPeak;

  const moonColour = sky.moonColour;
  const moonPeak = peakOf(moonColour);
  const moonIntensity =
    Math.max(sky.moonIntensity, 0) * SUN_GAIN * (1 - daylight) * moonPeak * 0.5;

  const useMoon = moonIntensity > sunIntensity;
  const key = {
    source: useMoon ? "moon" : "sun",
    direction: toStageDirection(
      useMoon ? sky.moonDirection : sky.sunDirection,
    ),
    /* Цвет нормализован к единице, а яркость вынесена в intensity: цвет ярче
       единицы в three умножается на intensity ещё раз и уводит кадр в белое. */
    colour: (useMoon ? moonColour : sunColour).map(
      (channel) => channel / (useMoon ? moonPeak : sunPeak),
    ),
    intensity: useMoon ? moonIntensity : sunIntensity,
    /* Тени в игре гаснут вместе с солнцем: ночная тень от луны — это ошибка
       предпросмотра, а не эффект. */
    castShadow: !useMoon && daylight > 0.06,
  };

  const ambientSky = sky.ambientUpColour.map(
    (channel) => channel * Math.max(sky.ambientUpIntensity, 0),
  );
  const ambientGround = sky.ambientDownColour.map(
    (channel) => channel * Math.max(sky.ambientDownIntensity, 0),
  );

  const keyed =
    exposureMode === "fixed"
      ? Number(fixedStops) || 0
      : exposureMode === "enclosed"
        ? enclosedExposureStops(sky)
        : Math.min(autoExposureStops(sky), NIGHT_EXPOSURE_CEILING);
  /* Собственная экспозиция таймцикла (`postfx_exposure`) добавляется ко всем
     режимам, кроме заданного вручную: там число редактора — это уже ответ. */
  const exposureStops =
    keyed +
    (exposureMode === "fixed" ? 0 : Number(sky.exposure || 0)) +
    Number(exposureBias);

  /*
   * Цвет тумана — горизонт, а не отдельно подобранная серость: линия, где
   * дальний объект растворяется, обязана совпасть с линией, где купол неба
   * упирается в землю. Разъедутся — и на горизонте появится шов, который в
   * игре не существует.
   */
  const fogColour = [0, 1, 2].map(
    (channel) =>
      sky.fogColour[channel] * sky.fogColour[3] * Math.max(sky.fogHdr, 0),
  );

  return {
    hour,
    weather: findWeather(weather)?.id || "EXTRASUNNY",
    region,
    sky,
    daylight,
    sunElevation: sunUp,
    /* Оба светила в осях сцены: купол рисует и солнце, и луну одновременно,
       а ключевой свет берёт только одно из них. */
    stageSun: toStageDirection(sky.sunDirection),
    stageMoon: toStageDirection(sky.moonDirection),
    key,
    ambient: {
      sky: ambientSky,
      ground: ambientGround,
      intensity: AMBIENT_GAIN,
    },
    fog: {
      /* Линейный HDR — для купола: он рисуется материалом сцены и проходит
         плёночную кривую вместе со всем кадром. */
      colour: fogColour,
      /* Экранный — для `scene.fog`: туман three накладывается уже после
         кривой, см. `displayFogColour`. */
      display: displayFogColour(fogColour, exposureStops),
      falloff: fogFalloff(sky),
    },
    exposureMode,
    exposureStops,
    toneMappingExposure: 2 ** exposureStops * ACES_EXPOSURE_MATCH,
    /* Множитель для собственного света закрытой сцены — см. `interiorGainFor`.
       Отдаётся вместе со светом, чтобы сцене не пришлось повторять формулу
       окна у себя. */
    interiorGain: interiorGainFor(2 ** exposureStops * ACES_EXPOSURE_MATCH),
    /* Цвет очистки буфера — тот же горизонт, но уже сведённый плёночной
       кривой: он виден лишь долю секунды до первого кадра купола, и чёрная
       вспышка на этом месте читается как поломка. */
    clearColour: tonemapPreview(fogColour, exposureStops),
  };
}

export { SCENE_LIGHT };
