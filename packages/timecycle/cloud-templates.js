/*
 * Готовые облака: всё облачное небо одной плиткой.
 *
 * Паки таймциклов, которые собирают ребята (COLOR, «Nevek V48»), красивы не
 * новыми моделями — своих облаков в паках нет, — а тем, как собраны
 * ванильные. Одна шапка у них — пять-восемь слоёв разных облаков сразу:
 * кучевые с башнями у горизонта, пряди и барашки над ними; и свет, при
 * котором у облака есть освещённая сторона и тень, — прямой свет солнца
 * сильнее, рассеянный слабее. Отсюда объём вместо плоской «гташной» пелены.
 *
 * Шаблон Astral — то же самое, но из файла самого игрока:
 *
 *   слои    — пары «шапка → модель» из его `clouds.xml`: каждая модель есть в
 *             игре, раз её называет его файл, и берётся со всеми своими
 *             числами (переходы, поворот, вес). Чего у игрока нет, то молча
 *             выпадает; не осталось ни одного слоя — шаблона нет;
 *   движение — поля целой шапки (масштаб, высота, скорость листов, вес
 *             деталей) — от одной шапки игрока, для которой они и подобраны;
 *   место   — шапка `horizonband3`: её не держит ни один набор ванили, и
 *             шаблон встаёт на её номер, не сдвигая ни одного бита чужих
 *             наборов. Держит её набор игрока (мод облаков) — шаблону места
 *             нет, и он честно недоступен;
 *   свет    — набор `cloudkeyframes.xml` игрока, чьим светом ваниль освещает
 *             облака этого веса, и поверх — стиль шаблона: во сколько раз
 *             прямой свет, заливка и окружение (`styleCloudKeys`). Числа
 *             пака ребята не переносятся: у каждого редукса свой свет, и
 *             стиль ложится на него, как и весь вид (`look.js`).
 *
 * Шапок с шаблоном — ровно столько же, сколько у игрока, слоёв в ней — не
 * больше, чем у самой богатой шапки ванили (`Cloudy 01`: одиннадцать, из
 * них видимых с земли семь), а их общий вес не выше единицы, как у ванили.
 * Всё прочее в файле — байт в байт как было.
 */

import { parseCloudHats } from "./cloud-hats.js";

/** Шапка, на месте которой живёт шаблон. */
export const CLOUD_TEMPLATE_SLOT = "horizonband3";

/* Видимых с земли слоёв — не больше, чем у `Cloudy 01` ванили. */
const MAX_GROUND_LAYERS = 7;
/* Общий вес видимых слоёв (`mCostFactor`) — не выше, чем у шапок ванили. */
const MAX_GROUND_COST = 1;

/*
 * Стиль света поверх набора: множители к разделам `cloudkeyframes.xml`.
 *
 *   diffuse, fill, ambient — `CloudScaleDiffuseFillAmbient_WrapAmount`: прямой
 *                  свет солнца, заливка от неба и окружение. Объём — это
 *                  прямой свет сильнее при слабом окружении: у облака
 *                  появляются светлый бок и тёмное брюхо;
 *   edges        — масштаб плотности (`CloudDensityShift_Scale…`, второй
 *                  канал): выше — края резче, облако «рваное»;
 *   lining       — сила пробоя (`CloudPiercingLightPower_Strength…`, второй
 *                  канал): серебряная кайма против солнца;
 *   relief       — сила нормалей (там же, третий канал): рельеф клубов.
 */
const STYLE_KEYS = Object.freeze([
  "diffuse",
  "fill",
  "ambient",
  "edges",
  "lining",
  "relief",
]);

function template(spec) {
  return Object.freeze({
    id: spec.id,
    label: Object.freeze({ ru: spec.ru, en: spec.en }),
    hint: Object.freeze({ ru: spec.hint, en: "" }),
    lighting: spec.lighting,
    motion: spec.motion,
    layers: Object.freeze(spec.layers.map((pair) => Object.freeze([...pair]))),
    style: Object.freeze(
      Object.fromEntries(
        STYLE_KEYS.map((key) => [key, spec.style?.[key] ?? 1]),
      ),
    ),
  });
}

/*
 * Шаблоны. Имена — по тому, как небо выглядит, а не по метеорологии. Слои —
 * `[шапка, модель]` из ванильного `clouds.xml`; свет — родной набор самых
 * тяжёлых облаков шаблона (как у выбора видов, `cloudLightingFor`).
 */
export const CLOUD_TEMPLATES = Object.freeze([
  template({
    id: "towering",
    ru: "Кучевые громады",
    en: "Towering cumulus",
    hint: "Объёмные облака и башни над горизонтом",
    lighting: "MEDIUMclouds",
    motion: "Cloudy 01",
    layers: [
      ["Cloudy 01", "cloudhat_cloudy_base"],
      ["Cloudy 01", "cloudhat_cloudy_c"],
      ["Cloudy 01", "cloudhat_cloudy_e"],
      /* Слои Nimbus убраны 22.11.2026: на кадрах стенда они давали «карточки» с прямым краем (вариант А без Nimbus чист; Б без cloudy_base снова с краями). */
      ["Clear 01", "cloudhat_clear01_b"],
    ],
    style: {
      diffuse: 1.6,
      fill: 0.7,
      ambient: 0.35,
      edges: 1.15,
      lining: 1.2,
      relief: 1.2,
    },
  }),
  template({
    id: "summer",
    ru: "Летний день",
    en: "Summer day",
    hint: "Белые облака россыпью и лёгкие пряди",
    lighting: "MEDIUMclouds",
    motion: "Clear 01",
    layers: [
      ["Clear 01", "cloudhat_clear01_a"],
      ["Clear 01", "cloudhat_clear01_b"],
      ["Clear 01", "cloudhat_clear01_c"],
      ["Cloudy 01", "cloudhat_cloudy_d"],
      ["Puffs", "cloudhat_PUFF_a"],
      ["Wispy", "cloudhat_WISPY_b"],
      ["Cirrus", "cloudhat_cirrus"],
    ],
    style: {
      diffuse: 1.35,
      fill: 0.85,
      ambient: 0.55,
      edges: 1.1,
      lining: 1.1,
      relief: 1.1,
    },
  }),
  template({
    id: "ragged",
    ru: "Рваные облака",
    en: "Broken clouds",
    hint: "Клочья после дождя, небо в просветах",
    lighting: "MEDIUMclouds",
    motion: "shower",
    layers: [
      ["shower", "cloudhat_shower_a"],
      ["shower", "cloudhat_shower_c"],
      ["Cloudy 01", "cloudhat_cloudy_b"],
      ["Cloudy 01", "cloudhat_cloudy_e"],
      ["Wispy", "cloudhat_WISPY_a"],
    ],
    style: {
      diffuse: 1.7,
      fill: 0.65,
      ambient: 0.3,
      edges: 1.35,
      lining: 1.4,
      relief: 1.25,
    },
  }),
  template({
    id: "cirrus",
    ru: "Перистое небо",
    en: "Cirrus sky",
    hint: "Высокие пряди и барашки — на закате горят",
    lighting: "LIGHTclouds",
    motion: "Wispy",
    layers: [
      ["Cirrus", "cloudhat_cirrus"],
      ["Wispy", "cloudhat_WISPY_a"],
      ["Wispy", "cloudhat_WISPY_b"],
      ["cirrocumulus", "cloudhat_cirrocumulus_b"],
    ],
    style: {
      diffuse: 1.1,
      fill: 1.1,
      ambient: 0.8,
      edges: 1,
      lining: 1.2,
      relief: 1,
    },
  }),
  template({
    id: "horizon",
    ru: "Гряды на горизонте",
    en: "Cloud ranges",
    hint: "Облачные горы по кругу, над головой чисто",
    lighting: "MEDIUMclouds",
    motion: "Horizon",
    layers: [
      ["Horizon", "cloudhat_HORIZON_a"],
      ["Horizon", "cloudhat_HORIZON_b"],
      ["Horizon", "cloudhat_HORIZON_c"],
      ["Nimbus", "cloudhat_nimbus_a"],
      ["Clear 01", "cloudhat_clear01_c"],
    ],
    style: {
      diffuse: 1.5,
      fill: 0.75,
      ambient: 0.4,
      edges: 1.15,
      lining: 1.2,
      relief: 1.15,
    },
  }),
  template({
    id: "mackerel",
    ru: "Барашки",
    en: "Mackerel sky",
    hint: "Мелкая рябь высоко в небе и пряди под ней",
    lighting: "LIGHTclouds",
    motion: "cirrocumulus",
    layers: [
      ["cirrocumulus", "cloudhat_cirrocumulus_a"],
      ["cirrocumulus", "cloudhat_cirrocumulus_b"],
      ["Wispy", "cloudhat_WISPY_b"],
      ["Horizon", "cloudhat_HORIZON_a"],
    ],
    style: {
      diffuse: 1.2,
      fill: 1,
      ambient: 0.7,
      edges: 1.1,
      lining: 1.2,
      relief: 1.1,
    },
  }),
  template({
    id: "storm",
    ru: "Грозовой фронт",
    en: "Storm front",
    hint: "Тяжёлые тёмные тучи с просветами солнца",
    lighting: "STORMclouds",
    motion: "Stormy 01",
    layers: [
      ["Stormy 01", "cloudhat_stormy01_a"],
      ["Stormy 01", "cloudhat_stormy01_b"],
      ["Stormy 01", "cloudhat_stormy01_d"],
      ["Nimbus", "cloudhat_nimbus_c"],
      ["shower", "cloudhat_shower_b"],
    ],
    style: {
      diffuse: 1.8,
      fill: 0.7,
      ambient: 0.3,
      edges: 1.2,
      lining: 1.5,
      relief: 1.25,
    },
  }),
  template({
    id: "layers",
    ru: "Слоистое небо",
    en: "Layered sky",
    hint: "Высокая пелена и облачные слои под ней",
    lighting: "HEAVYclouds",
    motion: "altostratus",
    layers: [
      ["altostratus", "cloudhat_altostatus_a"],
      ["altostratus", "cloudhat_altostatus_b"],
      ["stratoscumulus", "cloudhat_stratocumulus"],
      ["Cloudy 01", "cloudhat_cloudy_base"],
    ],
    style: {
      diffuse: 1.3,
      fill: 0.85,
      ambient: 0.6,
      edges: 1,
      lining: 1.1,
      relief: 1.1,
    },
  }),
]);

export const CLOUD_TEMPLATE_IDS = Object.freeze(
  CLOUD_TEMPLATES.map((item) => item.id),
);

const TEMPLATE_BY_ID = new Map(CLOUD_TEMPLATES.map((item) => [item.id, item]));
/**
 * Шаблон по номеру: готовый, а если такого нет — один из своих (`own`, список
 * `look.clouds.own`: собранные человеком шаблоны едут в проекте неба).
 */
export const findCloudTemplate = (id, own = null) =>
  TEMPLATE_BY_ID.get(String(id)) ||
  (Array.isArray(own) ? own.find((item) => item?.id === String(id)) : null) ||
  null;

const lower = (value) => String(value ?? "").toLowerCase();
const isGround = (layer) => !(Number(layer?.heightTrigger) > 0);

/**
 * Где шаблону жить у этого игрока: номер шапки-слота, если её не держит ни
 * один набор, а ясный (`clearSetting`) может её разрешить. `null` — места
 * нет.
 */
export function cloudTemplateSlot(
  cloudHats,
  cloudKeyframes = null,
  clearSetting = "LIGHTclouds",
) {
  const hats = cloudHats?.hats || [];
  const index = hats.findIndex(
    (hat) => lower(hat.name) === CLOUD_TEMPLATE_SLOT,
  );
  if (index < 0 || index >= 31) return null;
  for (const setting of cloudKeyframes?.settings?.values?.() || []) {
    if ((setting.bits >>> index) & 1) return null;
    if (setting.name === clearSetting && Number(setting.bitCount) <= index)
      return null;
  }
  return { index, name: hats[index].name };
}

/**
 * Из чего шаблон собирается у этого игрока: шапка движения, видимые слои
 * (найденные у него, не больше семи) и высотные слои шапки движения — кольцо
 * у горизонта перед видимыми, остальные после, как в ванили. `null` — нет
 * шапки движения или ни одного видимого слоя.
 */
export function cloudTemplatePlan(cloudHats, rawTemplate) {
  const template =
    typeof rawTemplate === "string"
      ? findCloudTemplate(rawTemplate)
      : rawTemplate;
  const hats = cloudHats?.hats || [];
  if (!template) return null;
  const motion = hats.find((hat) => lower(hat.name) === lower(template.motion));
  if (!motion) return null;
  const ground = [];
  const seen = new Set();
  for (const [hatName, file] of template.layers) {
    if (ground.length >= MAX_GROUND_LAYERS) break;
    const hat = hats.find((item) => lower(item.name) === lower(hatName));
    const index = hat?.layers.findIndex(
      (layer) => lower(layer.file) === lower(file) && isGround(layer),
    );
    if (!hat || index < 0 || seen.has(lower(file))) continue;
    seen.add(lower(file));
    ground.push({ hat: hat.index, layer: index });
  }
  if (!ground.length) return null;
  const firstGround = motion.layers.findIndex(isGround);
  const altitude = motion.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => !isGround(layer));
  const before = altitude.filter(
    ({ index }) => firstGround >= 0 && index < firstGround,
  );
  const after = altitude.filter(
    ({ index }) => !(firstGround >= 0 && index < firstGround),
  );
  /* Вес видимых слоёв — как у ванили, не выше единицы: порядок слоёв при
     смене погоды сохраняется, а общий вес не превышает шапок игры. */
  const cost = ground.reduce(
    (total, item) =>
      total +
      Math.max(Number(hats[item.hat].layers[item.layer].costFactor) || 0, 0),
    0,
  );
  const costScale = cost > MAX_GROUND_COST ? MAX_GROUND_COST / cost : 1;
  return {
    template,
    motion: motion.index,
    layers: [
      ...before.map(({ index }) => ({
        hat: motion.index,
        layer: index,
        ground: false,
      })),
      ...ground.map((item) => ({ ...item, ground: true })),
      ...after.map(({ index }) => ({
        hat: motion.index,
        layer: index,
        ground: false,
      })),
    ],
    costScale,
  };
}

/**
 * Шапка шаблона для кадра — в той же форме, что шапки `parseCloudHats`:
 * поля движения — от шапки движения, слои — собранные.
 */
export function cloudTemplateFrag(cloudHats, rawTemplate) {
  const plan = cloudTemplatePlan(cloudHats, rawTemplate);
  if (!plan) return null;
  const hats = cloudHats.hats;
  const motion = hats[plan.motion];
  return {
    ...motion,
    name: CLOUD_TEMPLATE_SLOT,
    template: plan.template.id,
    layers: plan.layers.map(({ hat, layer, ground }) => {
      const source = hats[hat].layers[layer];
      return ground
        ? {
            ...source,
            costFactor: (Number(source.costFactor) || 0) * plan.costScale,
          }
        : { ...source };
    }),
  };
}

/* --- Запись в clouds.xml --- */

/* Комментарии — пробелами той же длины: смещения в тексте остаются верными,
   а `<Item>` внутри комментария не считается шапкой. */
const maskComments = (text) =>
  text.replace(/<!--[\s\S]*?-->/g, (comment) => " ".repeat(comment.length));

/** Верхние `<Item>` в куске текста: смещения их начала и конца. */
function itemSpans(masked, from, to) {
  const spans = [];
  const regex = /<\/?Item>/g;
  regex.lastIndex = from;
  let depth = 0;
  let start = -1;
  for (;;) {
    const match = regex.exec(masked);
    if (!match || match.index >= to) break;
    if (match[0] === "<Item>") {
      if (depth === 0) start = match.index;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        spans.push({ start, end: match.index + match[0].length });
        start = -1;
      }
    }
  }
  return spans;
}

/** Шапки файла с их слоями — смещениями в тексте. */
function hatSpans(text) {
  const masked = maskComments(text);
  const open = masked.indexOf("<mCloudHatFrags>");
  const close = masked.indexOf("</mCloudHatFrags>");
  if (open < 0 || close < open)
    throw new Error("В clouds.xml нет списка шапок.");
  return itemSpans(masked, open + "<mCloudHatFrags>".length, close).map(
    (hat) => {
      const layersOpen = masked.indexOf("<mLayers>", hat.start);
      const layersClose = masked.indexOf("</mLayers>", hat.start);
      const hasLayers =
        layersOpen >= 0 && layersClose > layersOpen && layersClose < hat.end;
      return {
        ...hat,
        layersOpen: hasLayers ? layersOpen + "<mLayers>".length : -1,
        layersClose: hasLayers ? layersClose : -1,
        layers: hasLayers
          ? itemSpans(masked, layersOpen + "<mLayers>".length, layersClose)
          : [],
      };
    },
  );
}

/* Отступ строки, с которой начинается кусок. */
function indentBefore(text, offset) {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const indent = text.slice(lineStart, offset);
  return /^[ \t]*$/.test(indent) ? indent : "";
}

const formatNumber = (value) => (Number.isFinite(value) ? value : 0).toFixed(6);

/**
 * `clouds.xml` игрока с шаблоном на месте шапки-слота.
 *
 * Правка точечная: заменяется только содержимое шапки-слота, собранное из
 * кусков того же файла (поля шапки движения, слои своих шапок с их
 * отступами и переводами строк), имя слота остаётся — по нему шапку зовут
 * скрипты игры. Собранное разбирается заново и сверяется: шапок столько
 * же, прочие — те же, у слота — ровно задуманные слои. Не сошлось —
 * отказ, а не файл «примерно такой».
 *
 * @returns {{ xml: string, slot: {index: number, name: string}, layers: string[] }}
 */
export function writeCloudTemplate(
  xml,
  rawTemplate,
  { cloudKeyframes = null, clearSetting = "LIGHTclouds" } = {},
) {
  const text = String(xml ?? "");
  const template =
    typeof rawTemplate === "string"
      ? findCloudTemplate(rawTemplate)
      : rawTemplate;
  if (!template) throw new Error("Такого шаблона облаков нет.");
  const before = parseCloudHats(text);
  const slot = cloudTemplateSlot(before, cloudKeyframes, clearSetting);
  if (!slot)
    throw new Error(
      "Места для шаблона в clouds.xml нет: шапку-слот держит набор облаков.",
    );
  const plan = cloudTemplatePlan(before, template);
  if (!plan) throw new Error("Слоёв шаблона в clouds.xml игрока нет.");
  const spans = hatSpans(text);
  if (spans.length !== before.hats.length)
    throw new Error("Шапки clouds.xml не разбираются однозначно.");
  const motion = spans[plan.motion];
  const target = spans[slot.index];
  if (motion.layersOpen < 0) throw new Error("У шапки движения нет слоёв.");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";

  const layerText = ({ hat, layer, ground }) => {
    const span = spans[hat].layers[layer];
    let item = text.slice(span.start, span.end);
    if (ground && plan.costScale < 1) {
      const cost =
        (Number(before.hats[hat].layers[layer].costFactor) || 0) *
        plan.costScale;
      item = item.replace(
        /(<mCostFactor\s+value=")[^"]*(")/,
        (whole, open, close) => `${open}${formatNumber(cost)}${close}`,
      );
    }
    return `${indentBefore(text, span.start)}${item}`;
  };
  const closingIndent = indentBefore(text, motion.layersClose);
  const layersInner = `${eol}${plan.layers.map(layerText).join(eol)}${eol}${closingIndent}`;

  const motionItem = text.slice(motion.start, motion.end);
  const relative = (offset) => offset - motion.start;
  let item =
    motionItem.slice(0, relative(motion.layersOpen)) +
    layersInner +
    motionItem.slice(relative(motion.layersClose));
  const slotName = text
    .slice(target.start, target.end)
    .match(/<mName>([^<]*)<\/mName>/)?.[1];
  item = item.replace(
    /<mName>[^<]*<\/mName>/,
    `<mName>${slotName ?? CLOUD_TEMPLATE_SLOT}</mName>`,
  );
  const written = text.slice(0, target.start) + item + text.slice(target.end);

  const after = parseCloudHats(written);
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const expected = cloudTemplateFrag(before, template);
  const placed = after.hats[slot.index];
  if (
    after.hats.length !== before.hats.length ||
    after.hats.some(
      (hat, index) => index !== slot.index && !same(hat, before.hats[index]),
    ) ||
    lower(placed?.name) !== lower(slot.name) ||
    !same(
      placed.layers.map((layer) => [
        layer.file,
        layer.heightTrigger,
        layer.costFactor.toFixed(6),
      ]),
      expected.layers.map((layer) => [
        layer.file,
        layer.heightTrigger,
        layer.costFactor.toFixed(6),
      ]),
    )
  )
    throw new Error("Собранный clouds.xml не совпал с задуманным.");
  return {
    xml: written,
    slot,
    layers: plan.layers
      .filter((layer) => layer.ground)
      .map(({ hat, layer }) => before.hats[hat].layers[layer].file),
  };
}

/* --- Свет --- */

const SCALE_ROWS = Object.freeze([
  [
    "CloudScaleDiffuseFillAmbient_WrapAmount",
    (style) => [style.diffuse, style.fill, style.ambient, 1],
  ],
  [
    "CloudDensityShift_Scale_ScatteringConst_Scale",
    (style) => [1, style.edges, 1, 1],
  ],
  [
    "CloudPiercingLightPower_Strength_NormalStrength_Thickness",
    (style) => [1, style.lining, style.relief, 1],
  ],
]);

/**
 * Ключи набора со стилем шаблона: разделы, которые стиль трогает, —
 * умноженными по каналам, остальные — как были. Ключи — строки
 * `[час, a, b, c, d]`, как их разбирает `parseCloudKeyframes`.
 */
export function styleCloudKeys(keys = {}, style = null) {
  if (!style) return { ...keys };
  const styled = { ...keys };
  for (const [section, factorsOf] of SCALE_ROWS) {
    const rows = keys[section];
    if (!Array.isArray(rows) || !rows.length) continue;
    const factors = factorsOf(style);
    if (factors.every((factor) => factor === 1)) continue;
    styled[section] = rows.map(([hour, ...channels]) => [
      hour,
      ...channels.map((value, channel) =>
        factors[channel] === undefined ? value : value * factors[channel],
      ),
    ]);
  }
  return styled;
}

/* --- Свои облака: шаблон, собранный человеком --- */

/*
 * Свой шаблон — тот же объект, что готовый (`{ id, lighting, motion, layers, style }`), только его собрал человек из
 * облачных моделей игры. Новых моделей и листов облаков в нём нет: слои — пары «шапка → модель» из `clouds.xml`
 * самого игрока, и всё, что пакет не пропустит, до файла не дойдёт. Пределы те же, что у готовых, и сторожит их
 * пакет, а не окно: видимых слоёв не больше семи (`MAX_GROUND_LAYERS`), их общий вес при записи не выше единицы
 * (`cloudTemplatePlan` сжимает лишнее), множители стиля — в границах готовых шаблонов, расширенных в полтора раза.
 */

/** Сколько своих шаблонов держит проект неба. */
export const OWN_CLOUD_LIMITS = Object.freeze({ templates: 12, layers: MAX_GROUND_LAYERS, nameLength: 40 });

/** Наборы света, из которых выбирает свой шаблон: ясный день, облачный, пасмурный, грозовой. */
export const OWN_CLOUD_LIGHTINGS = Object.freeze(["LIGHTclouds", "MEDIUMclouds", "HEAVYclouds", "STORMclouds"]);

/*
 * Границы множителей стиля: от самого слабого готового значения, делённого на полтора, до самого сильного,
 * умноженного на полтора (до двух знаков) — человек уходит от готовых, но не туда, где облака ломаются.
 */
export const OWN_CLOUD_STYLE_LIMITS = Object.freeze(
  Object.fromEntries(
    STYLE_KEYS.map((key) => {
      const values = CLOUD_TEMPLATES.map((item) => item.style[key]);
      return [
        key,
        Object.freeze({
          min: Math.round((Math.min(...values) / 1.5) * 100) / 100,
          max: Math.round(Math.max(...values) * 1.5 * 100) / 100,
        }),
      ];
    }),
  ),
);

const OWN_ID = /^own-[a-z0-9]{4,24}$/;
/* Имена шапок и моделей — латиница, цифры, пробел, `_`, `.`, `-`: так их пишет Rockstar и моды облаков. */
const FILE_NAME = /^[A-Za-z0-9 _.-]{1,48}$/;

const clampStyle = (key, value) => {
  const { min, max } = OWN_CLOUD_STYLE_LIMITS[key];
  const number = Number(value);
  const base = Number.isFinite(number) ? number : 1;
  return Math.round(Math.min(max, Math.max(min, base)) * 100) / 100;
};

/** Новый номер своего шаблона: `own-` и восемь знаков из случайных 0…1. */
export function ownCloudId(random = Math.random) {
  let tail = "";
  while (tail.length < 8) tail += Math.floor(random() * 36).toString(36);
  return `own-${tail}`;
}

/**
 * Свой шаблон в пределах пакета.
 *
 * Без `cloudHats` проверяется только вид: номер, имя, набор света, шапка движения, не более семи слоёв, стиль в
 * границах. С разобранным `clouds.xml` игрока слои без модели у него выпадают — по имени (`dropped`), — а шапка
 * движения без такой шапки остаётся как есть: шаблон тогда просто не встанет (`cloudTemplatePlan` → `null`), и окно
 * скажет почему. Пустой набор слоёв — шаблона нет (`template: null`).
 *
 * @returns {{ template: object|null, dropped: Array<{hat: string, file: string}> }}
 */
export function normalizeOwnCloudTemplate(raw, cloudHats = null) {
  const none = { template: null, dropped: [] };
  if (!raw || typeof raw !== "object") return none;
  const id = lower(raw.id);
  if (!OWN_ID.test(id)) return none;
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim().slice(0, OWN_CLOUD_LIMITS.nameLength);
  if (!name) return none;
  const lighting = OWN_CLOUD_LIGHTINGS.includes(raw.lighting) ? raw.lighting : "MEDIUMclouds";
  const motion = FILE_NAME.test(String(raw.motion ?? "")) ? String(raw.motion) : "Cloudy 01";
  const hats = cloudHats?.hats || null;
  const seen = new Set();
  const layers = [];
  const dropped = [];
  for (const pair of Array.isArray(raw.layers) ? raw.layers : []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const hatName = String(pair[0] ?? "");
    const file = String(pair[1] ?? "");
    if (!FILE_NAME.test(hatName) || !FILE_NAME.test(file) || seen.has(lower(file))) continue;
    if (layers.length >= OWN_CLOUD_LIMITS.layers) break;
    if (hats) {
      const hat = hats.find((item) => lower(item.name) === lower(hatName));
      const found = hat?.layers.some((layer) => lower(layer.file) === lower(file) && isGround(layer));
      if (!found) {
        dropped.push({ hat: hatName, file });
        continue;
      }
    }
    seen.add(lower(file));
    layers.push([hatName, file]);
  }
  if (!layers.length) return { template: null, dropped };
  const style = Object.fromEntries(STYLE_KEYS.map((key) => [key, clampStyle(key, raw.style?.[key])]));
  return {
    template: Object.freeze({
      id,
      own: true,
      /* `name` — как хранится и приходит из проекта; `label` — как читают плитки готовых шаблонов. */
      name,
      label: Object.freeze({ ru: name, en: name }),
      hint: Object.freeze({ ru: "", en: "" }),
      lighting,
      motion,
      layers: Object.freeze(layers.map((pair) => Object.freeze(pair))),
      style: Object.freeze(style),
    }),
    dropped,
  };
}

/** Что из слоёв шаблона есть у игрока, чего нет, и сколько весят видимые (`cloudTemplatePlan` сжимает вес выше единицы). */
export function cloudTemplateReport(cloudHats, rawTemplate) {
  const template = typeof rawTemplate === "string" ? findCloudTemplate(rawTemplate) : rawTemplate;
  const hats = cloudHats?.hats || [];
  const present = [];
  const missing = [];
  for (const [hatName, file] of template?.layers || []) {
    const hat = hats.find((item) => lower(item.name) === lower(hatName));
    const layer = hat?.layers.find((item) => lower(item.file) === lower(file) && isGround(item));
    if (layer) present.push({ hat: hatName, file, costFactor: Math.max(Number(layer.costFactor) || 0, 0) });
    else missing.push({ hat: hatName, file });
  }
  const cost = present.reduce((total, item) => total + item.costFactor, 0);
  return { present, missing, cost, scaled: cost > MAX_GROUND_COST, limit: MAX_GROUND_LAYERS };
}

/** Своя копия готового шаблона для «Изменить копию»: те же слои, свет и стиль, свой номер и имя. */
export function ownCloudFromTemplate(rawTemplate, { id, name } = {}) {
  const source = typeof rawTemplate === "string" ? findCloudTemplate(rawTemplate) : rawTemplate;
  if (!source) return null;
  return normalizeOwnCloudTemplate({
    id: id || ownCloudId(),
    name: name || source.label?.ru || source.id,
    lighting: source.lighting,
    motion: source.motion,
    layers: source.layers,
    style: source.style,
  }).template;
}
