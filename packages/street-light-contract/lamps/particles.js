/*
 * Частицы у фонарей: бабочки, мотыльки, светлячки, лепестки, листья, снег.
 *
 * В игре такие частицы — «окружающие эффекты» пропов: в описании модели
 * (`.ytyp`) у архетипа лежит расширение `CExtensionDefParticleEffect` с
 * именем из `entityfx.dat`, а таблица говорит, какое правило частиц какого
 * словаря играть и когда. Так Rockstar держит мух над мусорками и мотыльков
 * у двух ламп на всю карту; так же сделан и мод «бабочки у фонарей»
 * (`jokerci`): он дописал бабочек ста трём архетипам фонарей.
 *
 * Редактор делает то же самое, но своим именем и из файлов самого игрока:
 *
 *  • правило — клон штатного правила ядра (`core.ypt` игрока) под именем
 *    `astral_lamp_fx`: поведение (как кружат, падают, мерцают) приходит от
 *    Rockstar, а цвет, размер, прозрачность и густота — из работы;
 *  • строка `ASTRAL_LAMP_FX` в `entityfx.dat` — когда играть: ночью или
 *    всегда;
 *  • расширение у архетипов выбранных групп — ГДЕ играть: в точке самой
 *    лампы, а не у основания столба, как у мода (там рой стоял на асфальте).
 *
 * Текстуры Rockstar в поставке Astral не лежат: голубые и алые бабочки —
 * это лист бабочек из ядра самого игрока, перекрашенный при установке
 * (`recolour.js`); тот же лист перекрашивается и в окне для предпросмотра.
 *
 * Шаблон ниже — только замысел: донор, лист, нейтральные множители. Числа
 * для клона собирает `compile.js`, а окно — тот же `buildEffectClone`, что и
 * установщик, поэтому бабочки в предпросмотре летают ровно по тем правилам,
 * что уедут в игру.
 */

/** Имя правила клона в ядре и строки в entityfx.dat. */
export const LAMP_FX_PREFIX = "astral_lamp_";
export const LAMP_FX_RULE = "astral_lamp_fx";
export const LAMP_FX_TAG = "ASTRAL_LAMP_FX";

/*
 * Лист бабочек ядра: `ptfx_insects_rgb`, сетка 4×4, кадры 4–7 — монархи
 * (строка 1). Перекрашенный лист — одна эта строка, 4×1: кадры 0–3.
 * Четверть листа вместо целого — четверть мегабайта вместо полутора в
 * каждом из трёх ядер (обычное, `_hi`, `_lo`).
 */
export const BUTTERFLY_DONOR = "ent_amb_butterflys_swarm";

export const BUTTERFLY_SHEET = Object.freeze({
  source: "ptfx_insects_rgb",
  columns: 4,
  rows: 4,
  row: 1,
  frames: Object.freeze([4, 7]),
});

/*
 * Варианты перекраски крыльев. `hue` — тон, в который уходит оранжевый
 * монарха (градусы), `saturation` — множитель насыщенности. `neutral` —
 * «серые» крылья под свой цвет: тогда цвет задают кадры правила.
 */
export const BUTTERFLY_VARIANTS = Object.freeze({
  morpho: Object.freeze({ texture: "astral_lamp_wings_morpho", hue: 214, saturation: 1.05, lightness: 1.08 }),
  scarlet: Object.freeze({ texture: "astral_lamp_wings_scarlet", hue: 356, saturation: 1.1, lightness: 0.96 }),
  neutral: Object.freeze({ texture: "astral_lamp_wings_neutral", neutral: true }),
  /* Монархи как есть — строкой без перекраски. Своя строка нужна, когда
     бабочки летят чужим движением: правило падения или парения рисует свой
     лист, и подменить его можно только листом из пространства имён Astral. */
  monarch: Object.freeze({ texture: "astral_lamp_wings_monarch", identity: true }),
});

const template = (id, fields) => Object.freeze({ id, ...fields });

/*
 * Картинка плитки шаблона — кадры листа ядра самого игрока: та самая
 * бабочка, лепесток, лист или снежинка, что полетит у лампы (текстур
 * Rockstar в поставке нет, лист приходит из игры). `frames` — номера кадров
 * сетки листа, `variants` — перекраска крыльев для каждого кадра, `glow` —
 * огонёк, `tint` — кадр красится цветом шаблона, как в игре.
 */
const picture = (sheet, frames, options = {}) => Object.freeze({ sheet, frames: Object.freeze(frames), ...options });

/** Шаблон своей картинки. */
export const CUSTOM_TEMPLATE = "custom";

/* Рой бабочек у лампы: сфера в метр с небольшим под плафоном, до восьми
   бабочек на слой при густоте 100 %. */
const BUTTERFLY_SPAWN = Object.freeze([1.8, 4.5, 8]);
const BUTTERFLY_DOMAIN = Object.freeze({ size: Object.freeze([1.2, 0, 0]), lift: -0.6 });
const BUTTERFLY_GLOW = 0.5;
/* Падающее — из-под самой лампы, через её свет к земле. */
const FALL_SPAWN = Object.freeze([20, 30, 14]);
const FALL_DOMAIN = Object.freeze({ size: Object.freeze([1.8, 0, 0]), lift: 0.3 });
/* Парящее — облако огоньков вокруг плафона. */
const FLOAT_SPAWN = Object.freeze([1.5, 3, 22]);
const FLOAT_DOMAIN = Object.freeze({ size: Object.freeze([1.8, 1.8, 1.3]), lift: -0.8 });

/*
 * ВИД И ДВИЖЕНИЕ — ОТДЕЛЬНО
 *
 * Как летает частица, решает правило-донор ядра: бабочки кружат под
 * притяжением к центру роя, лепестки падают под ускорением вниз и шумом,
 * пылинки парят на затухающей скорости. Как частица выглядит — лист, который
 * это правило рисует. Поэтому любой вид можно пустить любым движением: донор
 * движения остаётся, а его лист подменяется листом вида. Так давно летала
 * своя картинка; теперь так же — бабочки, лепестки, снег и огоньки.
 *
 * Родное движение шаблона собирается ровно как прежде (свой донор и его
 * числа — клон байт в байт тот же). Чужое — через лист вида под именем
 * Astral: правило клона вправе рисовать только своё пространство имён.
 *
 * `size` — средний видимый размер частицы донора в метрах (ширина кадра
 * `ptxu_Size` × размер эмиттера, из ядра Legacy): по нему лист вида на
 * чужом доноре получает тот размер, каким он был у своего. `playback` —
 * темп эмиттера донора (`m_playbackRateScalarKFP`, x): от него считается
 * «Скорость». `customSize` — размер своей картинки на этом доноре.
 */
export const PARTICLE_MOTIONS = Object.freeze([
  Object.freeze({
    id: "swarm",
    label: "Кружат",
    description: "Вьются роем под плафоном, как бабочки у лампы",
    donor: BUTTERFLY_DONOR,
    texture: BUTTERFLY_SHEET.source,
    spawn: BUTTERFLY_SPAWN,
    domain: BUTTERFLY_DOMAIN,
    size: 0.228,
    playback: 0.621964,
    customSize: 160,
    /* Донор листает кадры листа (взмахи крыльев). */
    animates: true,
  }),
  Object.freeze({
    id: "fall",
    label: "Падают",
    description: "Сыплются из-под лампы и кружатся к земле, как лепестки",
    donor: "ent_amb_falling_cherry_bloss",
    texture: "ptfx_flower_petals",
    spawn: FALL_SPAWN,
    domain: FALL_DOMAIN,
    size: 0.11,
    playback: 1,
    customSize: 240,
  }),
  Object.freeze({
    id: "float",
    label: "Парят",
    description: "Медленно плывут в свете вокруг лампы, как огоньки",
    donor: "ent_amb_dust_motes",
    texture: "ptfx_glow",
    spawn: FLOAT_SPAWN,
    domain: FLOAT_DOMAIN,
    size: 0.035,
    playback: 1,
    customSize: 320,
  }),
]);

export const PARTICLE_MOTION_IDS = Object.freeze(PARTICLE_MOTIONS.map((item) => item.id));

export function particleMotion(id) {
  return PARTICLE_MOTIONS.find((item) => item.id === id) || PARTICLE_MOTIONS[0];
}

/*
 * Темп эмиттера у доноров, где он задан (у остальных пустое свойство — это
 * единица). «Скорость» работы умножает его: частица проживает жизнь и
 * пролетает путь быстрее или медленнее, а густота на месте.
 */
export const DONOR_PLAYBACK = Object.freeze({
  ent_amb_butterflys_swarm: 0.621964,
  ent_amb_moths_swarm: 0.621964,
});

/*
 * Листы видов под именами Astral — для чужого движения. `source` — лист
 * ядра игрока, `row` — одна строка кадров листа из `sourceRows` строк (у
 * листа насекомых), `columns` и `rows` — сетка ГОТОВОГО листа (она же
 * уходит в ptxclipregions.dat). Текстур Rockstar в поставке нет: лист
 * собирается из ядра самого игрока — и в окне, и установщиком.
 */
export const PARTICLE_LOOK_SHEETS = Object.freeze({
  moths: Object.freeze({
    texture: "astral_lamp_look_moths",
    source: BUTTERFLY_SHEET.source,
    sourceRows: 4,
    row: 0,
    columns: 4,
    rows: 1,
  }),
  glow: Object.freeze({ texture: "astral_lamp_look_glow", source: "ptfx_glow", columns: 1, rows: 1 }),
  petals: Object.freeze({ texture: "astral_lamp_look_petals", source: "ptfx_flower_petals", columns: 2, rows: 2 }),
  snow: Object.freeze({ texture: "astral_lamp_look_snow", source: "ptfx_snow_flake", columns: 1, rows: 1 }),
});

/*
 * Шаблоны. `colour` — цвет шаблона (для подписи и обложки), `colourable` —
 * можно ли выбрать свой цвет. У бабочек свой цвет — это нейтральный лист
 * плюс цвет кадров; у остальных — цвет кадров донора.
 *
 * `tint: "template"` — цвет шаблона кладётся в кадры всегда: у пыли игры
 * кадры серые, у листьев — зеленовато-бурые, а шаблон обещает светлячков и
 * рыжую осень. Остальные без своего цвета остаются цвета донора: мотыльки
 * белые, лепестки розовые, снег белый — как у Rockstar.
 *
 * `density` — множитель густоты по умолчанию: у доноров Rockstar рой задуман
 * для одного куста или одной мусорки, а у фонаря человек хочет увидеть
 * бабочек сразу, а не ждать, пока одна прилетит.
 *
 * `emissive` — собственное свечение частиц (сила, как в кадрах правила),
 * `sizeScalar` — размер эмиттера в процентах. У бабочек и мотыльков
 * Rockstar местный свет выключен (`extralightmult` 0): ночью их видно
 * только по слабому свечению 0,137 — у фонаря рой был бы тёмными точками,
 * поэтому шаблон светит им чуть сильнее, как будто их высвечивает лампа.
 * Ползунок «Свечение» работы умножает это число.
 *
 * `spawn` — рождения в секунду «от» и «до» и предел живых частиц (третье
 * число густоты эмиттера; 0 — без предела), `domain` — где рождаются:
 * размер области (у сферы — радиус первым числом) и подъём от лампы в
 * метрах. У доноров Rockstar рой задуман для куста — сфера в четверть метра,
 * шесть бабочек; у фонаря их должно быть видно под плафоном, поэтому область
 * шире и опущена под лампу, в самый свет. Густота работы умножает и
 * рождения, и предел: иначе «вдвое гуще» упиралось бы в те же шесть.
 *
 * `motion` — родное движение шаблона, `motions` — какие движения ему можно
 * дать (по умолчанию все три), `look` — как вид ложится на чужой донор:
 * строки крыльев (`wings`, по слою на строку) или лист вида (`sheet` из
 * `PARTICLE_LOOK_SHEETS`), `apparent` — видимый размер частицы в метрах у
 * своего донора, `frames` — кадры листа, `animate` — кадры листа — это
 * взмахи (бабочки, мотыльки), а не разные частицы: на доноре с анимацией
 * листа они листаются, у остальных частица берёт один кадр.
 */
const BUTTERFLY_SIZE = 0.146;
const WING_FRAMES = Object.freeze([0, 3]);
const SINGLE_FRAME = Object.freeze([0, 0]);

export const PARTICLE_TEMPLATES = Object.freeze([
  template("monarch", {
    label: "Монархи",
    description: "Оранжевые бабочки игры кружат у лампы",
    kind: "swarm",
    motion: "swarm",
    layers: Object.freeze([{ donor: BUTTERFLY_DONOR, variant: null }]),
    look: Object.freeze({ wings: Object.freeze(["monarch"]), apparent: BUTTERFLY_SIZE, frames: WING_FRAMES, animate: true }),
    colour: "#FF9A2E",
    colourable: true,
    density: 1,
    spawn: BUTTERFLY_SPAWN,
    domain: BUTTERFLY_DOMAIN,
    emissive: BUTTERFLY_GLOW,
    picture: picture("ptfx_insects_rgb", [5], { variants: [null] }),
  }),
  template("morpho", {
    label: "Голубые бабочки",
    description: "Синие морфо — как в моде «бабочки у фонарей»",
    kind: "swarm",
    motion: "swarm",
    layers: Object.freeze([{ donor: BUTTERFLY_DONOR, variant: "morpho" }]),
    look: Object.freeze({ wings: Object.freeze(["morpho"]), apparent: BUTTERFLY_SIZE, frames: WING_FRAMES, animate: true }),
    colour: "#3E8BFF",
    colourable: true,
    density: 1,
    spawn: BUTTERFLY_SPAWN,
    domain: BUTTERFLY_DOMAIN,
    emissive: BUTTERFLY_GLOW,
    picture: picture("ptfx_insects_rgb", [5], { variants: ["morpho"] }),
  }),
  template("scarlet", {
    label: "Алые бабочки",
    description: "Красные крылья в свете фонаря",
    kind: "swarm",
    motion: "swarm",
    layers: Object.freeze([{ donor: BUTTERFLY_DONOR, variant: "scarlet" }]),
    look: Object.freeze({ wings: Object.freeze(["scarlet"]), apparent: BUTTERFLY_SIZE, frames: WING_FRAMES, animate: true }),
    colour: "#FF3348",
    colourable: true,
    density: 1,
    spawn: BUTTERFLY_SPAWN,
    domain: BUTTERFLY_DOMAIN,
    emissive: BUTTERFLY_GLOW,
    picture: picture("ptfx_insects_rgb", [5], { variants: ["scarlet"] }),
  }),
  template("motley", {
    label: "Пёстрый рой",
    description: "Монархи, голубые и алые вперемешку",
    kind: "swarm",
    motion: "swarm",
    layers: Object.freeze([
      { donor: BUTTERFLY_DONOR, variant: null },
      { donor: BUTTERFLY_DONOR, variant: "morpho" },
      { donor: BUTTERFLY_DONOR, variant: "scarlet" },
    ]),
    look: Object.freeze({
      wings: Object.freeze(["monarch", "morpho", "scarlet"]),
      apparent: BUTTERFLY_SIZE,
      frames: WING_FRAMES,
      animate: true,
    }),
    colour: "#B35CFF",
    colourable: false,
    density: 0.6,
    spawn: BUTTERFLY_SPAWN,
    domain: BUTTERFLY_DOMAIN,
    emissive: BUTTERFLY_GLOW,
    picture: picture("ptfx_insects_rgb", [5, 6, 4], { variants: [null, "morpho", "scarlet"] }),
  }),
  template("moths", {
    label: "Мотыльки",
    description: "Белые мотыльки летят на свет",
    kind: "swarm",
    motion: "swarm",
    layers: Object.freeze([{ donor: "ent_amb_moths_swarm", variant: null }]),
    look: Object.freeze({ sheet: "moths", apparent: 0.107, frames: WING_FRAMES, animate: true }),
    colour: "#F4F1E6",
    colourable: true,
    density: 1.2,
    spawn: Object.freeze([8.9, 9.2, 10]),
    domain: Object.freeze({ size: Object.freeze([1.3, 0, 0]), lift: -0.4 }),
    emissive: 0.35,
    picture: picture("ptfx_insects_rgb", [1, 2, 0]),
  }),
  template("fireflies", {
    label: "Светлячки",
    description: "Мерцающие огоньки вокруг лампы",
    kind: "float",
    motion: "float",
    layers: Object.freeze([{ donor: "ent_amb_dust_motes", variant: null }]),
    /* Размер светлячка задают его кадры (`ptxu_Size` в метрах), а не донор:
       на любом движении он того же размера. */
    look: Object.freeze({ sheet: "glow", apparent: null, frames: SINGLE_FRAME, animate: false }),
    colour: "#C8FF4D",
    tint: "template",
    colourable: true,
    density: 1,
    spawn: Object.freeze([1.5, 3, 22]),
    domain: Object.freeze({ size: Object.freeze([1.8, 1.8, 1.3]), lift: -0.8 }),
    picture: picture("ptfx_glow", [0], { glow: true, count: 7 }),
  }),
  template("motes", {
    label: "Искры в свете",
    description: "Пылинки, что светятся в луче фонаря",
    kind: "float",
    motion: "float",
    layers: Object.freeze([{ donor: "ent_amb_dust_motes", variant: null }]),
    look: Object.freeze({ sheet: "glow", apparent: 0.0385, frames: SINGLE_FRAME, animate: false }),
    colour: "#FFE3A3",
    tint: "template",
    colourable: true,
    density: 1,
    spawn: Object.freeze([12.6, 15.6, 0]),
    domain: Object.freeze({ size: Object.freeze([1.4, 1.4, 1.2]), lift: -0.9 }),
    emissive: 2.2,
    sizeScalar: 110,
    picture: picture("ptfx_glow", [0], { glow: true, count: 14, small: true }),
  }),
  template("sakura", {
    label: "Сакура",
    description: "Розовые лепестки падают из-под лампы",
    kind: "fall",
    motion: "fall",
    layers: Object.freeze([{ donor: "ent_amb_falling_cherry_bloss", variant: null }]),
    /* Розовый лепестков — в кадрах донора, а не в листе: на чужом движении
       его несёт цвет вида. */
    look: Object.freeze({
      sheet: "petals",
      apparent: 0.143,
      frames: Object.freeze([0, 3]),
      animate: false,
      paint: "template",
    }),
    colour: "#FFB3D9",
    colourable: true,
    density: 1,
    spawn: FALL_SPAWN,
    domain: FALL_DOMAIN,
    emissive: 0.25,
    sizeScalar: 130,
    picture: picture("ptfx_flower_petals", [0, 1, 2, 3]),
  }),
  template("autumn", {
    label: "Осенние листья",
    description: "Жёлтые и рыжие листья кружат и падают",
    kind: "fall",
    motion: "fall",
    /* Лист — объёмная модель, а не спрайт: чужому движению его не отдать,
       и листья только падают. */
    motions: Object.freeze(["fall"]),
    layers: Object.freeze([{ donor: "ent_amb_leaves_oak_g", variant: null }]),
    colour: "#FF9F1C",
    tint: "template",
    colourable: true,
    density: 1,
    spawn: FALL_SPAWN,
    domain: FALL_DOMAIN,
    picture: picture("ptfx_model_coins_leaves", [0], { tint: true }),
  }),
  template("snow", {
    label: "Снежинки",
    description: "Снег в свете фонаря, даже без зимы",
    kind: "fall",
    motion: "fall",
    layers: Object.freeze([{ donor: "env_snow_flakes", variant: null }]),
    look: Object.freeze({ sheet: "snow", apparent: 0.16, frames: SINGLE_FRAME, animate: false }),
    colour: "#FFFFFF",
    colourable: true,
    density: 1,
    spawn: Object.freeze([9, 13, 48]),
    domain: Object.freeze({ size: Object.freeze([3.2, 3.2, 0.6]), lift: 0.8 }),
    sizeScalar: 45,
    picture: picture("ptfx_snow_flake", [0]),
  }),
  template(CUSTOM_TEMPLATE, {
    label: "Своя картинка",
    description: "Загрузите PNG, JPG или WebP — у лампы полетит она",
    kind: "custom",
    motion: null,
    colour: "#FFFFFF",
    colourable: true,
    density: 1,
    emissive: 0.6,
  }),
]);

/*
 * СВОЯ КАРТИНКА
 *
 * Картинка человека ложится листом 1×1 вместо листа донора, а как ей
 * летать — решает донор движения: кружить, как бабочки, падать, как лепестки,
 * или парить огоньком. Листья сюда не входят: у них частица — сетка листа,
 * и чужая картинка легла бы на неё обрывками.
 *
 * `texture` — лист донора, который картинка подменяет, `sizeScalar` — размер
 * эмиттера: бабочка игры — двенадцать сантиметров, и фотография такого
 * размера была бы пятнышком. Движения — те же три, что у любого шаблона
 * (`PARTICLE_MOTIONS`); здесь их подписи про одну картинку.
 */
export const CUSTOM_TEXTURE = "astral_lamp_custom";
export const CUSTOM_TEXTURE_EDGE = 128;

const CUSTOM_WORDING = Object.freeze({
  swarm: Object.freeze({ label: "Кружит", description: "Как бабочки у лампы" }),
  fall: Object.freeze({ label: "Падает", description: "Как лепестки сакуры" }),
  float: Object.freeze({ label: "Парит", description: "Как огоньки в свете" }),
});

export const CUSTOM_MOTIONS = Object.freeze(
  PARTICLE_MOTIONS.map((motion) =>
    Object.freeze({
      id: motion.id,
      ...CUSTOM_WORDING[motion.id],
      donor: motion.donor,
      texture: motion.texture,
      spawn: motion.spawn,
      domain: motion.domain,
      sizeScalar: motion.customSize,
    }),
  ),
);

export const CUSTOM_MOTION_IDS = Object.freeze(CUSTOM_MOTIONS.map((item) => item.id));

export function customMotion(id) {
  return CUSTOM_MOTIONS.find((item) => item.id === id) || CUSTOM_MOTIONS[0];
}

/** Какие движения можно дать шаблону: по умолчанию все три. */
export function templateMotions(template) {
  return template?.motions || PARTICLE_MOTION_IDS;
}

/** Родное движение шаблона; у своей картинки родного нет — кружит. */
export function nativeMotion(template) {
  return template?.motion || PARTICLE_MOTIONS[0].id;
}

/**
 * Движение, которым частицы летят на деле: выбранное, если шаблону оно
 * позволено, иначе родное.
 */
export function effectiveMotion(template, motion) {
  return templateMotions(template).includes(motion) ? motion : nativeMotion(template);
}

export const PARTICLE_TEMPLATE_IDS = Object.freeze(
  PARTICLE_TEMPLATES.map((item) => item.id),
);

/* Шаблон новой работы: голубые морфо — то, ради чего частицы и заводят. */
export const DEFAULT_PARTICLE_TEMPLATE = "morpho";

export function particleTemplate(id) {
  return (
    PARTICLE_TEMPLATES.find((item) => item.id === id) ||
    PARTICLE_TEMPLATES.find((item) => item.id === DEFAULT_PARTICLE_TEMPLATE)
  );
}

/** Правила ядра, которые нужны шаблонам: их выгружает помощник для окна. */
export const PARTICLE_DONORS = Object.freeze([
  ...new Set([
    ...PARTICLE_TEMPLATES.flatMap((item) => (item.layers || []).map((layer) => layer.donor)),
    ...CUSTOM_MOTIONS.map((motion) => motion.donor),
  ]),
]);

/** Листы ядра, из которых собираются перекрашенные бабочки и листы видов. */
export const PARTICLE_SOURCE_TEXTURES = Object.freeze([
  ...new Set([BUTTERFLY_SHEET.source, ...Object.values(PARTICLE_LOOK_SHEETS).map((sheet) => sheet.source)]),
]);
