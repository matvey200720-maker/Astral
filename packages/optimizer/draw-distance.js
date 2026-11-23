/*
 * «Дальность прорисовки» — договор (задача 7 ТЗ 06.10.2026).
 *
 * Как это делает сама игра. В таймцикле GTA V есть число `far_clip` — дальняя
 * плоскость отсечения: дальше неё мир не рисуется вовсе, и это настоящая
 * экономия кадра (меньше сеток дальних планов, меньше вызовов отрисовки).
 * Rockstar режет ею дальность сама — модификаторы `ReduceDrawDistance` и
 * `ReduceDrawDistanceMAP` (`timecycle_mods_1.xml`): `far_clip`, тёмная дымка
 * и укороченные отражения. Включаются они коробкой модификатора в карте
 * (`CMapData.timeCycleModifiers`): пока камера в коробке, модификатор
 * действует; у Rockstar такие коробки бывают в десятки километров
 * (`hei_hw1_blimp.ymap`, часы 0–23).
 *
 * Astral делает так же: свой модификатор `AstralDrawDistance` (движок кладёт
 * его в `timecycle_mods_2.xml` объединением по имени, модификаторы игры и
 * чужих модов остаются) и своя карта `astral_draw_distance.ymap` с одной
 * коробкой этого модификатора на всю карту, круглые сутки.
 *
 * Что показали замеры в игре (стенд `tools/ingame-qa`, числа модификатора
 * правились прямо в памяти игры, константы тумана — дампом `cbdump`):
 *
 *   • Туман — высотный: плотность в шейдере = `fog_density`·10⁻⁴ ·
 *     e^(−`fog_falloff`/1000 · (высота − `fog_base_height`)). При
 *     `fog_falloff` 0 тумана нет совсем — поэтому прежняя стена не
 *     появлялась. Пологий спад 0,5 (полкилометра подъёма — минус 22 %) даёт
 *     одну и ту же стену у земли, на холме и с вертолёта; плата за это —
 *     небо тоже уходит в цвет стены: туман, который закрывает землю на
 *     дальности, закрывает и купол (так туман и выглядит изнутри).
 *   • Плотность подобрана по кадрам с одной точки на всех ступенях: на
 *     дальности мир закрыт, до половины дальности читается —
 *     `75000 · D^(−0,86)` (2500 м → 90, 1000 → 198, 300 → 556, 150 → 1011).
 *   • У цвета в модификаторе два числа — значение и вес смешивания с
 *     погодой (у Rockstar у цветов всегда «… 1.000»); «0 0» — вес 0, погода
 *     оставалась своей. Цвет пишется с весом 1.
 *   • Цвет тумана идёт в шейдер умноженным на `fog_hdr` погоды (в полдень
 *     ×24, ночью ×0,1), и тон-кривая игры днём выжигает его в белёсый: красный
 *     выходил лососевым. Канал поэтому кладётся «с запасом под кривую»
 *     (`fogChannel`): днём стена того цвета, что выбран, ночью — темнее
 *     вместе с миром. Белый — 1, чернота — 0.
 *   • Дымка (`fog_haze_*`) кладётся на фон за отсечкой своим множителем
 *     яркости — край мира выходил полосой другой яркости. Дымка выключена:
 *     фон за отсечкой закрывает тот же туман купола того же цвета.
 *   • `water_reflection_far_clip` (у погоды 7 км) и
 *     `reflection_slod_range_end` (1 км) — отражения воды, машин и стёкол
 *     рисуют мир за стеной; их режет та же дальность — ещё кадры.
 *
 * Пока ползунок не тронут («Как в игре»), ставить нечего: «Установить» с
 * «Как в игре» снимает пакет.
 */

export const DRAW_DISTANCE_MODIFIER = "AstralDrawDistance";
export const DRAW_DISTANCE_MAP = "astral_draw_distance";
export const DRAW_DISTANCE_TIMECYCLE_FILE = "timecycle_mods_2.xml";
export const DRAW_DISTANCE_CONTAINER = "x64/astral/astral_draw_distance.rpf";

/* Дальность, м: от самой короткой стены до самой дальней; шаг ползунка. */
export const DRAW_DISTANCE_LIMITS = Object.freeze({ min: 150, max: 2500, step: 50 });
export const DRAW_DISTANCE_DEFAULT = 800;

/*
 * Ступени — дальности, на которых сняты кадры с одной высокой точки
 * (`assets/draw-distance/`): ползунок показывает ближайший кадр. «Как в игре»
 * — кадр без модификатора.
 */
export const DRAW_DISTANCE_STOPS = Object.freeze([2500, 1600, 1000, 700, 450, 300, 150]);

/* Коробка на всю карту: остров Кайо-Перико и горы — внутри, с запасом. */
export const DRAW_DISTANCE_BOX = Object.freeze({
  min: Object.freeze([-9000, -9000, -1000]),
  max: Object.freeze([9000, 10000, 6000]),
  percentage: 100,
  range: 100,
  startHour: 0,
  endHour: 23,
});

const HEX = /^#[0-9a-f]{6}$/i;
const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const hex = (value, fallback) => (HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback);

/*
 * Цвет стены — один: туман игры красит стену одним цветом (второй цвет
 * погоды виден только у солнца, «ближе → дальше» у тумана нет). Поле —
 * общее поле цветовых эффектов в сплошном режиме.
 */
export function normalizeDrawDistanceLook(input) {
  const source = plain(input);
  return { mode: "solid", colour: hex(source.colour, "#000000") };
}

/** Дальность по ползунку: в пределах и по шагу; `null` — «Как в игре». */
export function normalizeDrawDistanceValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const { min, max, step } = DRAW_DISTANCE_LIMITS;
  return Math.min(max, Math.max(min, Math.round(number / step) * step));
}

export function normalizeDrawDistance(input) {
  const source = plain(input);
  return {
    distance: normalizeDrawDistanceValue(source.distance),
    look: normalizeDrawDistanceLook(source.look),
  };
}

export const drawDistanceIsStock = (input) => normalizeDrawDistance(input).distance === null;

/** Отпечаток для очереди «Установить»: то же, что уйдёт в игру. */
export function drawDistanceSignature(input) {
  const settings = normalizeDrawDistance(input);
  return settings.distance === null ? "stock" : JSON.stringify(settings);
}

/*
 * Канал цвета стены (0…255) → число тумана. Тон-кривая игры днём на
 * туман ×`fog_hdr`: на экране ≈ 1 − e^(−2,81·x) (замер по белой стене
 * 1,0 / 0,6 / 0,35 / 0,2 → 248 / 228 / 203 / 176 в полдень). Обратная
 * кривая с поправкой на автоэкспозицию (стена во весь экран уводит её вверх)
 * подобрана по кадрам: серый 128 → 136, зелёный (39, 174, 96) → (0, 178, 83),
 * синий (45, 107, 255) → (0, 115, 255). Совсем тёмные каналы игра гасит в
 * ноль (нижнее колено кривой).
 */
export function fogChannel(channel) {
  const value = Math.min(255, Math.max(0, Number(channel) || 0)) / 255;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Math.min(1, (0.6 * -Math.log(1 - value ** 1.5)) / 2.81);
}

const fogColour = (value) => {
  const number = parseInt(value.slice(1), 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255].map((channel) => Math.round(fogChannel(channel) * 10000) / 10000);
};

/* Плотность тумана по дальности — подбор по кадрам из игры (см. шапку). */
export const drawDistanceDensity = (distance) => Math.round(75000 * distance ** -0.86);

/*
 * Числа модификатора. `far_clip` — чуть дальше стены: мир кончается там,
 * где его уже не видно. Туман начинается на 0,4 дальности.
 */
export function drawDistanceValues(input) {
  const { distance, look } = normalizeDrawDistance(input);
  if (distance === null) return null;
  const colour = fogColour(look.colour);
  const clip = Math.round(distance * 1.05);
  return {
    far_clip: clip,
    fog_start: Math.round(distance * 0.4),
    fog_density: drawDistanceDensity(distance),
    fog_falloff: 0.5,
    fog_alpha: 1,
    fog_near_col: colour,
    fog_col: colour,
    fog_east_col: colour,
    fog_moon_col: colour,
    fog_haze_density: 0,
    water_reflection_far_clip: clip,
    reflection_slod_range_end: Math.min(1000, clip),
  };
}

const number = (value) => Number(value).toFixed(3);
const exact = (value) => Number(value).toFixed(4);

/** Модификатор таймцикла (`timecycle_modifier_data`) с одним `AstralDrawDistance`. */
export function drawDistanceModifierXml(input) {
  const values = drawDistanceValues(input);
  if (!values) throw new Error("«Как в игре» — модификатора нет.");
  const rows = [];
  /* Число: оба значения одинаковы. Цвет: значение и вес смешивания 1. */
  const add = (name, value) => rows.push(`    <${name}>${number(value)} ${number(value)}</${name}>`);
  const colour = (name, value) => rows.push(`    <${name}>${exact(value)} 1.000</${name}>`);
  add("water_reflection_far_clip", values.water_reflection_far_clip);
  add("fog_start", values.fog_start);
  for (const name of ["fog_near_col", "fog_col", "fog_moon_col", "fog_east_col"]) {
    colour(`${name}_r`, values[name][0]);
    colour(`${name}_g`, values[name][1]);
    colour(`${name}_b`, values[name][2]);
    colour(`${name}_a`, 1);
  }
  add("fog_density", values.fog_density);
  add("fog_falloff", values.fog_falloff);
  add("fog_alpha", values.fog_alpha);
  add("fog_haze_density", values.fog_haze_density);
  add("reflection_slod_range_end", values.reflection_slod_range_end);
  add("far_clip", values.far_clip);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<timecycle_modifier_data version="1.000000">',
    `  <modifier name="${DRAW_DISTANCE_MODIFIER}" numMods="${rows.length}" userFlags="0">`,
    ...rows,
    "  </modifier>",
    "</timecycle_modifier_data>",
    "",
  ].join("\n");
}

/** Запрос нативному хосту (`compile-timecycle-box`): карта с коробкой на всю карту. */
export function drawDistanceBoxRequest() {
  return {
    format: "astral.timecycle-box",
    version: 1,
    name: DRAW_DISTANCE_MAP,
    modifier: DRAW_DISTANCE_MODIFIER,
    min: [...DRAW_DISTANCE_BOX.min],
    max: [...DRAW_DISTANCE_BOX.max],
    percentage: DRAW_DISTANCE_BOX.percentage,
    range: DRAW_DISTANCE_BOX.range,
    startHour: DRAW_DISTANCE_BOX.startHour,
    endHour: DRAW_DISTANCE_BOX.endHour,
  };
}

/** Ближайшая ступень-кадр для дальности (`null` — «Как в игре»). */
export function drawDistanceStop(distance) {
  if (distance === null || distance === undefined) return null;
  return DRAW_DISTANCE_STOPS.reduce((best, stop) => (Math.abs(stop - distance) < Math.abs(best - distance) ? stop : best), DRAW_DISTANCE_STOPS[0]);
}
