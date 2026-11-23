/*
 * Константы шейдера облачных шапок — из набора `cloudkeyframes.xml`.
 *
 * Шапку игра рисует шейдерами `clouds_*.sps`; разбор пиксельного шейдера
 * `clouds_animsoft` (PSCloudsVertScatterPiercing_AnimSoft) даёт формулу:
 *
 *   плотность  d_i = 1 − g_i², где g_i — зелёный канал i-го листа;
 *   нормаль    смесь трёх карт с весами d_i · blend_i · combine_i;
 *   заливка    (восток − запад) · (N.x/2 + ½) + запад
 *              + отражённый · sat(−0.8·N.z + 0.2)
 *              + небо · sat(0.5714·N.z + 0.4286);
 *   свет       sat(N·L · wrap.x + wrap.y) · свет · diffuse
 *              + заливка · fill + окружение · ambient;
 *   цвет       цвет облака · свет + (1 − thickness·A) · рассеяние
 *              + пробой · свет · strength;
 *   альфа      A = sat((плотность − сдвиг) · масштаб) · альфа вершины.
 *
 * Здесь — только то, что игра считает на процессоре: как разделы набора
 * ложатся на эти константы. Разбор выводов:
 *
 * `CloudScaleFillColors` — четыре множителя заливки в порядке разделов файла:
 * небо, отражённый, восток, запад. Проверка по ванили: в 06:00 восток 1.15
 * против запада 0.9 (солнце встаёт на востоке), в 18:00 запад 1.5 против
 * востока 1.05 (садится на западе); в полночь заливка только от неба.
 *
 * `CloudScaleDiffuseFillAmbient_WrapAmount` — три множителя света и доля
 * «обёрнутого» освещения w: sat((N·L + w) / (1 + w)), то есть
 * wrap = (1/(1+w), w/(1+w)).
 *
 * `CloudDensityShift_Scale_ScatteringConst_Scale` — сдвиг и масштаб
 * плотности, g рассеяния Хеньи — Гринстейна и его яркость. Вершинный шейдер
 * считает (1 + μ²) / (1 + g² − 2gμ)^1.5, μ = cos угла к солнцу, — это форма
 * Корнетта — Шэнкса, и множитель фазы у неё 3(1 − g²) / (8π(2 + g²)).
 * Константа в файлах положительна (0.8…0.95): вперёд рассеивающие облака
 * светятся каймой, когда смотришь на солнце, — как и в игре.
 */

const channel = (row, index, fallback = 0) => {
  const value = Number(row?.[index]);
  return Number.isFinite(value) ? value : fallback;
};

const rgb = (row, scale = 1) => [
  channel(row, 0) * scale,
  channel(row, 1) * scale,
  channel(row, 2) * scale,
];

/** Множитель фазы Корнетта — Шэнкса для асимметрии g. */
export function cornetteShanksNorm(g) {
  const g2 = g * g;
  return (3 * (1 - g2)) / (8 * Math.PI * (2 + g2));
}

/**
 * Константы света шапки из разделов набора в выбранный час
 * (`sampleCloudSettings`). Отсутствующий раздел даёт нули — шапка без света
 * просто не видна, а не рисуется чужими числами.
 */
export function cloudHatShading(keys = {}) {
  const fill = keys.CloudScaleFillColors;
  const [skyScale, bounceScale, eastScale, westScale] = [0, 1, 2, 3].map(
    (index) => channel(fill, index, 1),
  );
  const east = rgb(keys.CloudEastColor, eastScale);
  const west = rgb(keys.CloudWestColor, westScale);
  const density = keys.CloudDensityShift_Scale_ScatteringConst_Scale;
  const g = Math.min(Math.max(channel(density, 2), -0.99), 0.99);
  const piercing = keys.CloudPiercingLightPower_Strength_NormalStrength_Thickness;
  const scales = keys.CloudScaleDiffuseFillAmbient_WrapAmount;
  const wrap = Math.max(channel(scales, 3), 0);
  return {
    cloudColour: rgb(keys.CloudColor),
    lightColour: rgb(keys.CloudLightColor),
    ambientColour: rgb(keys.CloudAmbientColor),
    skyColour: rgb(keys.CloudSkyColor, skyScale),
    bounceColour: rgb(keys.CloudBounceColor, bounceScale),
    westColour: west,
    eastMinusWestColour: east.map((value, index) => value - west[index]),
    densityShiftScale: [channel(density, 0), channel(density, 1, 1)],
    scatter: [g, g * g, cornetteShanksNorm(g), channel(density, 3)],
    piercing: [
      channel(piercing, 0, 1),
      channel(piercing, 1),
      channel(piercing, 2),
      channel(piercing, 3),
    ],
    scaleDiffuseFillAmbient: [
      channel(scales, 0),
      channel(scales, 1),
      channel(scales, 2),
    ],
    wrap: [1 / (1 + wrap), wrap / (1 + wrap)],
  };
}

/*
 * Движение слоёв шапки.
 *
 * У шапки в `clouds.xml` три листа: основной и два детальных. Скорость
 * листа — `mUVVelocity` (доля листа в секунду), режим — `mAnimMode`: 0 —
 * лист добавляет плотность, 1 — выедает её (детальный шум съедает края
 * основной формы; у «барашков» вес выедания под двадцать — отсюда рябь).
 * Вес — `mAnimBlendWeights`. Вся шапка поворачивается вокруг вертикали со
 * скоростью `mAngularVelocity.z`, слой — со своей долей `mRotationScale`.
 */
export function cloudHatMotion(frag, layer, seconds = 0) {
  const time = Number.isFinite(seconds) ? seconds : 0;
  const velocity = Array.isArray(frag?.uvVelocity) ? frag.uvVelocity : [];
  const modes = Array.isArray(frag?.animMode) ? frag.animMode : [];
  const blend = frag?.animBlendWeights || { x: 1, y: 0, z: 0 };
  const offsets = [0, 1, 2].map((index) => {
    const [u = 0, v = 0] = velocity[index] || [];
    return [u * time, v * time];
  });
  const sculpting = [0, 1, 2].map((index) => Number(modes[index]) === 1);
  return {
    offsets,
    blend: [blend.x ?? 1, blend.y ?? 0, blend.z ?? 0].map((value) =>
      Number.isFinite(Number(value)) ? Number(value) : 0,
    ),
    combine: sculpting.map((sculpt) => (sculpt ? 0 : 1)),
    sculpt: sculpting.map((sculpt) => (sculpt ? 1 : 0)),
    angle:
      (Number(frag?.angularVelocity?.z) || 0) *
      (Number(layer?.rotationScale) || 0) *
      time,
  };
}

/** Слои, видимые с земли: у остальных порог высоты камеры выше нуля. */
export const groundCloudLayers = (frag) =>
  (frag?.layers || []).filter((layer) => !(Number(layer.heightTrigger) > 0));

/**
 * Шапка, которую игра покажет чаще всех при этом наборе: наибольший вес
 * среди разрешённых битов, при равенстве — первая по порядку. Нужна кадру:
 * в игре шапку тянут жребием, а предпросмотр обязан быть одним и тем же при
 * каждом открытии.
 */
export function likeliestCloudHat(setting, cloudHats) {
  const hats = cloudHats?.hats || [];
  if (!setting || !hats.length) return null;
  let best = null;
  for (const [index, frag] of hats.entries()) {
    if (index >= 31 || !((setting.bits >>> index) & 1)) continue;
    const weight = Number(setting.probability?.[index]);
    const score = Number.isFinite(weight) ? weight : 1;
    if (score <= 0) continue;
    if (!best || score > best.score) best = { frag, score };
  }
  return best?.frag || null;
}
