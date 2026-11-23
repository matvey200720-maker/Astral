/*
 * Блики объектива.
 *
 * Полосы и кольца, которые камера GTA V рисует, когда в кадре солнце, — не
 * часть неба и не файл погоды. У каждого героя свой набор бликов в
 * `common.rpf/data`: `lensflare_m.xml` (Майкл — синяя полоса через весь
 * кадр), `lensflare_f.xml`, `lensflare_t.xml`, плюс общий `lensflare.xml`.
 * Файлы погоды только разрешают их и добавляют «артефакты объектива»
 * (`LENS_FLARE_WEATHER_PARAMETERS`): в ванильных погодах все четыре числа —
 * ноль, а редуксы их включают — так у владельца 26.09.2026 полоса и пятно
 * вокруг солнца и появились.
 *
 * Убрать блики — значит погасить каждый элемент наборов (`fIntensityScale`
 * → 0) и вернуть эти четыре числа погоды к ванильному нулю. Наборы правятся
 * по тексту игрока, как файлы погоды: CRLF, порядок элементов и все прочие
 * поля остаются как были, меняется только яркость. Копия ложится в
 * `update.rpf/common/data` и перекрывает `common.rpf` — так же ставят свои
 * блики моды сообщества («No Lens Flare», «Lens Flare and Corona
 * Replacement»).
 */

export const LENS_FLARE_FILES = Object.freeze([
  "lensflare.xml",
  "lensflare_f.xml",
  "lensflare_m.xml",
  "lensflare_t.xml",
]);

/** Числа погоды, которые разрешают блики и артефакты объектива. */
export const LENS_FLARE_WEATHER_PARAMETERS = Object.freeze([
  "Lensflare_visibility",
  "lens_artefacts_intensity",
  "lens_artefacts_min_exp_intensity",
  "lens_artefacts_max_exp_intensity",
]);

/*
 * Лучи от солнца (`light_ray_*`) — засвет, который игра рисует вокруг солнца
 * поверх кадра: оранжевые полосы и ореол по экрану. Кадра объектива в них нет,
 * но на взгляд это те же блики, и владелец видел их при выключенных бликах
 * (28.09.2026, лучи до 8 утром и 6 вечером в ванили). Проверено в игре: с
 * `light_ray_mult` 0 засвета нет, небо и свет на город — прежние.
 */
export const SUN_GLARE_PARAMETERS = Object.freeze(["light_ray_mult"]);

const INTENSITY = /(<fIntensityScale\s+value=")([^"]*)("\s*\/>)/g;
const SILENT = "0.000000";

/**
 * Набор бликов без бликов: яркость каждого элемента — ноль.
 *
 * `elements` — сколько элементов в наборе, `changed` — сколько из них
 * светилось. Набор без элементов — не набор бликов: текст не меняется.
 */
export function quietLensFlareXml(xml) {
  const text = String(xml ?? "");
  let elements = 0;
  let changed = 0;
  const quiet = text.replace(INTENSITY, (match, open, value, close) => {
    elements += 1;
    if (Number(value) === 0) return match;
    changed += 1;
    return `${open}${SILENT}${close}`;
  });
  return { xml: changed ? quiet : text, elements, changed };
}
