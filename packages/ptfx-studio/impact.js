/*
 * Эффекты попадания: что выбирает человек и во что это превращается в игре.
 *
 * Зон две — голова и тело, — а у зоны СЛОИ. Одна запись bloodfx.dat называет
 * одно правило эффекта, и до сих пор зона могла быть чем-то одним: кровью,
 * искрами или значком. Человек же хочет из одной раны и кровь, и искры, и
 * свой логотип разом. Поэтому зона — это стопка слоёв, а в ядро уезжает
 * составное правило: у каждого слоя свой донор и своя настройка, а события
 * всех слоёв стоят в правиле подряд (`tools/rpf-helper/YptEffectClones.cs`).
 *
 * Виды слоя:
 *
 *   blood    — штатная кровь игры целиком (все её эмиттеры: брызги, струи,
 *              пыль, капли), перекрашенная в выбранный цвет; сила брызг и
 *              плотность правятся в клоне правила. Кровей несколько — у игры
 *              есть хедшот, снайперская с лентой-кляксой, залп дроби, выходное
 *              отверстие, капли из горла и дымка, — и лист брызг можно
 *              подменить: нарисованные кляксы, капли, дымка, готовые значки
 *              (сердечки и кресты летят вместо капель) или своя картинка;
 *   template — штатный эффект игры как он есть: вода — всплеском, искры —
 *              искрами, купюры — купюрами. Поведение приносит само правило
 *              ядра, мы его только масштабируем и, если просят, красим.
 *              Клоунские эффекты (те самые «Majestic») живут не в ядре, а в
 *              словаре миссии `scr_rcbarry2.ypt` — установщик достаёт его из
 *              игры игрока, а помощник переносит их текстуры в ядро;
 *   custom   — картинка человека (или готовая из набора), всплывающая в точке
 *              попадания неосвещённым спрайтом: цвета PNG остаются цветами PNG
 *              и днём, и ночью.
 *
 * У слоя есть СТОРОНА: спереди — из входного отверстия, там, куда попала
 * пуля; сзади — из выходного, за спиной персонажа. Именно так летит клякса в
 * паках Majestic: кровь спереди, а звёзды и дым — из спины. В игре это две
 * записи (BLOODFX_ENTRY_INFO и BLOODFX_EXIT_INFO) и два составных правила.
 *
 * Зона без единого слоя, но включённая, — «без эффекта»: ни частиц, ни пятен.
 *
 * Дальность — у зоны, а не у слоя: игра сама увеличивает брызги с расстояния
 * (эволюция LOD: у крови размер эмиттера 90 % вблизи и 350 % за сорок метров),
 * и человек правит это одной парой множителей — вблизи и вдали — плюс
 * дальностью видимости всего эффекта.
 *
 * Каждый вид — клон своего штатного правила-донора в пространстве имён
 * `astral_impact_NNN`. Штатные правила игры не трогаются ни в одном байте.
 */

import { normalizeColour, parseColour } from "./shapes.js";
import { IMPACT_PICTURE_SHAPES } from "./pictures.js";
import {
  ruleEventCount,
  ruleEventParticles,
  ruleParticleTexture,
  ruleParticles,
  ruleParticlesDrawing,
} from "./rules.js";

/** Зоны, которыми думает человек, и зоны таблицы bloodfx.dat за ними. */
export const IMPACT_ZONES = Object.freeze([
  Object.freeze({
    id: "head",
    label: "Голова",
    description: "Попадание в голову — самый заметный эффект в игре.",
    bloodZones: Object.freeze(["head"]),
  }),
  Object.freeze({
    id: "body",
    label: "Тело",
    description: "Шея, корпус, руки и ноги — всё, что не голова.",
    bloodZones: Object.freeze([
      "throat",
      "torso",
      "arms",
      "legs",
      "extremities",
    ]),
  }),
]);

export const IMPACT_ZONE_IDS = Object.freeze(
  IMPACT_ZONES.map((zone) => zone.id),
);

export const findImpactZone = (id) =>
  IMPACT_ZONES.find((zone) => zone.id === id) || null;

/*
 * Виды слоя. «Без эффекта» — не вид слоя, а зона без слоёв: окно показывает
 * его плиткой рядом с видами, но в проекте это пустая стопка.
 */
export const IMPACT_KINDS = Object.freeze([
  Object.freeze({
    id: "blood",
    label: "Кровь",
    description: "Кровь игры: какая, какого цвета, из чего капли.",
  }),
  Object.freeze({
    id: "template",
    label: "Из игры",
    description: "Готовый эффект GTA: дым, огонь, молния, звёзды и цветы…",
  }),
  Object.freeze({
    id: "custom",
    label: "Картинка",
    description: "Готовый значок или свой PNG, всплывающий в точке попадания.",
  }),
]);

export const IMPACT_KIND_IDS = Object.freeze(
  IMPACT_KINDS.map((kind) => kind.id),
);

/*
 * Сколько слоёв помещается в зону и сколько эмиттеров — в одно правило игры.
 * Слоёв шесть: спереди и сзади по три — этого хватает на кровь, эффект и
 * значок с каждой стороны.
 *
 * Эмиттеров у правила — не больше СЕМИ. Ресурс ядра держит массив событий на
 * 32 места, и до 05.10.2026 Astral считал пределом его, но играет игра не
 * больше семи: у 5 028 правил в 400 словарях эффектов игры (вся update.rpf)
 * событий от одного до семи, у 34 словарей ровно семь — и ни одного больше.
 * Восьмое событие игра пишет за конец своего массива: все три краша на
 * попадании (24.09 — голова из четырёх слоёв, 05.10 — тело, 11 событий)
 * падают в одном месте, GTA5.exe+0x1282f28, на обходе восьмого эмиттера
 * (счётчик цикла 7) с затёртой старшей половиной указателя. Предел считается
 * по донорам каждой стороны (`impactZoneEmitters`) и держится и здесь, и в
 * помощнике RPF (`YptEffectClones.MaxEventEmitters`).
 */
export const IMPACT_LAYER_LIMIT = 6;
export const IMPACT_EMITTER_CAP = 7;

/*
 * Сторона слоя: входное отверстие (там, куда попала пуля) или выходное (за
 * спиной). В bloodfx.dat это две разные записи, и игра играет обе.
 */
export const IMPACT_PLACEMENTS = Object.freeze([
  Object.freeze({
    id: "front",
    label: "Спереди",
    description: "Из раны — там, куда попала пуля.",
  }),
  Object.freeze({
    id: "back",
    label: "Сзади",
    description:
      "Из выходного отверстия, за спиной персонажа — как клякса в паках Majestic.",
  }),
]);

export const IMPACT_PLACEMENT_IDS = Object.freeze(
  IMPACT_PLACEMENTS.map((item) => item.id),
);

/** Сторона слоя; слои прежних проектов — все спереди. */
export const layerPlacement = (layer) =>
  layer?.placement === "back" ? "back" : "front";

/** Слои зоны с одной стороны — с их номерами в стопке. */
export const placementLayers = (settings, placement) =>
  (settings?.layers || [])
    .map((layer, index) => ({ layer, index }))
    .filter((item) => layerPlacement(item.layer) === placement);

/*
 * Режимы цвета. Один цвет — тон и насыщенность от выбранного, яркость от
 * кадров донора. Два цвета — нижние кадры цвета одним, верхние другим: игра
 * выбирает каждой частице свою долю между ними, и облако выходит пёстрым.
 * Радуга — тон бежит по кругу за жизнь частицы; яркость и прозрачность
 * донора остаются («эрджибишная» кровь, как её называют на серверах).
 */
export const IMPACT_COLOUR_MODES = Object.freeze([
  Object.freeze({ id: "one", label: "Один цвет", description: "Выбранный цвет." }),
  Object.freeze({
    id: "duo",
    label: "Два цвета",
    description: "Каждой частице — свой оттенок между двумя цветами.",
  }),
  Object.freeze({
    id: "rainbow",
    label: "Радуга",
    description: "Цвет бежит по кругу за жизнь частицы — RGB.",
  }),
]);

export const IMPACT_COLOUR_MODE_IDS = Object.freeze(
  IMPACT_COLOUR_MODES.map((item) => item.id),
);

/*
 * Свечение: кадры эмиссии у поведения цвета. Так сделана «светящаяся кровь»
 * из чужих паков — три-шесть единиц эмиссии, и брызги светят сами по себе,
 * ночью в том числе. У штатных частиц эти кадры пусты.
 */
export const GLOW_EMISSIVE = Object.freeze([0, 3, 6, 0, 0]);
export const GLOW_PROP = "ptxu_Colour:m_emissiveIntensityKFP";

/* Штатная кровь: доноры зон и её цвет. Голова получает фатальный хедшот —
   с ошмётками, — тело обычное входное отверстие. */
export const VANILLA_BLOOD_COLOUR = "#8a0b0b";
export const BLOOD_DONORS = Object.freeze({
  head: "blood_headshot",
  body: "blood_entry",
});

/*
 * Какая кровь. У игры не одна кровь, а с десяток правил на разные случаи, и
 * чужие паки берут их за основу: «лента» в паках Majestic — это снайперский
 * хедшот `blood_entry_head_sniper`, где кроме облака летит отрезок-клякса
 * (частица `blood_head_seg`, модель, а не спрайт). Здесь они собраны словами
 * человека: маленькая, большая, с лентой, капли, дымка.
 */
const variant = (id, label, description, donors, extra = {}) =>
  Object.freeze({ id, label, description, donors: Object.freeze(donors), ...extra });

export const BLOOD_VARIANTS = Object.freeze([
  variant(
    "game",
    "Штатная",
    "Кровь игры как она есть: хедшот в голову, входное отверстие в тело.",
    BLOOD_DONORS,
  ),
  variant(
    "line",
    "С лентой",
    "Облако и лента-клякса из раны — как в паках Majestic.",
    { head: "blood_entry_head_sniper", body: "blood_entry_head_sniper" },
  ),
  variant("big", "Большая", "Широкий залп брызг — как от дроби.", {
    head: "blood_entry_shotgun",
    body: "blood_entry_shotgun",
  }),
  variant(
    "small",
    "Маленькая",
    "Короткая пыль и струйка — не закрывает прицел.",
    { head: "blood_exit", body: "blood_exit" },
  ),
  variant("drops", "Капли", "Крупные тяжёлые капли со струёй.", {
    head: "blood_throat",
    body: "blood_throat",
  }),
  /* Дымка — струйки дыма у самой раны (`blood_nose`: полтора десятка клубов
     по трети метра), а не `blood_mist`: тот — семиметровое облако. */
  variant("mist", "Дымка", "Мягкие струйки без капель — как туман у раны.", {
    head: "blood_nose",
    body: "blood_nose",
  }),
]);

export const BLOOD_VARIANT_IDS = Object.freeze(
  BLOOD_VARIANTS.map((item) => item.id),
);
const variantById = new Map(BLOOD_VARIANTS.map((item) => [item.id, item]));
export const findBloodVariant = (id) =>
  variantById.get(String(id || "")) || null;

/** Правило-донор крови зоны для выбранной крови. */
export const bloodDonor = (zoneId, variantId = "game") =>
  (findBloodVariant(variantId) || BLOOD_VARIANTS[0]).donors[zoneId] ||
  BLOOD_DONORS[zoneId];

/*
 * Лист штатной кровяной пыли несёт красный цвет прямо в пикселях (средний
 * цвет — 141, 33, 17), поэтому одной перекраской кадров цвета зелёную или
 * синюю кровь не получить: синий канал листа почти пуст. Клон крови рисует
 * нейтральную копию листа — ту же форму в оттенках серого, — а цвет даёт
 * правило. Копия одна на все слои крови.
 */
export const BLOOD_SPRAY_TEXTURE = "ptfx_blood_spray";
export const ASTRAL_BLOOD_SPRAY_TEXTURE = "astral_impact_blood_spray";

/* Частицы штатной крови, рисующие лист брызг: пыль у раны и капли. У других
   кровей свои (`ruleParticlesDrawing`), и подмена листа идёт по текстуре. */
export const BLOOD_SHEET_PARTICLES = Object.freeze([
  "blood_entry_blood_dust",
  "blood_drops",
]);

/** Частицы донора, которые рисуют лист брызг: им и подменяется лист. */
export const bloodSheetParticles = (donor) =>
  ruleParticlesDrawing(donor, BLOOD_SPRAY_TEXTURE);

/*
 * Чужие словари доноров. Клоунские эффекты — звёзды, дым, цветы и ленты, из
 * которых собраны все «Majestic»-паки, — игра держит в словаре миссии Барри
 * и грузит только на ней. Установщик достаёт словарь из update.rpf игрока,
 * помощник берёт из него правило и переносит в ядро его текстуры (под
 * именами `astral_impact_tex_*`, чтобы сняться вместе с семейством).
 *
 * `alternatives` — тот же словарь в других вариантах качества частиц: в
 * штатной Legacy он лежит и в `ptfx_hi.rpf`, и в `ptfx_lo.rpf` (в `ptfx.rpf`
 * его нет). У 71 установки беты (14–15.10) его нет в `ptfx_hi.rpf` — архив
 * переложен сборкой, — а донору годится любая копия.
 */
export const IMPACT_DONOR_FILES = Object.freeze([
  Object.freeze({
    id: "scr_rcbarry2",
    label: "словарь эффектов миссии Барри (клоуны)",
    entry: "x64/patch/data/effects/ptfx_hi.rpf/scr_rcbarry2.ypt",
    alternatives: Object.freeze([
      "x64/patch/data/effects/ptfx_lo.rpf/scr_rcbarry2.ypt",
    ]),
  }),
]);

export const findImpactDonorFile = (id) =>
  IMPACT_DONOR_FILES.find((item) => item.id === id) || null;

/**
 * Все доноры каталога по словарям: `null` — само ядро, иначе идентификатор
 * чужого словаря. По этому списку установщик выписывает правила из игры
 * игрока, а `scripts/bake-impact-rules.mjs` — из штатной игры.
 */
export function impactCatalogueRules() {
  const files = new Map([
    [null, new Set([CUSTOM_DONOR.effect, CUSTOM_SPIN_DONOR.effect])],
  ]);
  for (const item of BLOOD_VARIANTS)
    for (const rule of Object.values(item.donors)) files.get(null).add(rule);
  for (const item of IMPACT_TEMPLATES) {
    const key = item.file || null;
    if (!files.has(key)) files.set(key, new Set());
    files.get(key).add(item.rule);
  }
  return new Map(
    [...files].map(([file, names]) => [file, [...names].sort()]),
  );
}

/** Имя, под которым текстура чужого словаря живёт в ядре (как в помощнике). */
export function importedTextureName(name) {
  const lower = String(name || "")
    .trim()
    .toLowerCase();
  const stem = lower.startsWith("ptfx_") ? lower.slice(5) : lower;
  return `astral_impact_tex_${stem.replace(/[^a-z0-9_]/g, "_")}`;
}

/*
 * Листы брызг.
 *
 * Лист — это то, из чего сделана каждая частица пыли и каждая капля: сетка
 * кадров 4×4, белая с прозрачностью, а цвет ей даёт правило. Штатный лист
 * («как в игре») — нейтральная копия листа игрока; остальные рисует
 * приложение (`sheets.js`): нарисованные брызги и значки — те же контуры,
 * что у вида «Картинка», — и своя картинка человека.
 *
 * `animated` — кадры листа идут друг за другом за жизнь частицы (лист
 * нарисован как развитие одного всплеска), иначе частица держит один
 * случайный кадр: сердечко не должно мигать десятью сердечками.
 */
const sheet = (id, label, description, extra = {}) =>
  Object.freeze({ id, label, description, animated: false, ...extra });

/* Подписи значков-листов — те же слова, что у вида «Картинка», только во
   множественном числе: летит их много. */
const SHEET_GLYPH_LABELS = Object.freeze({
  heart: "Сердечки",
  cross: "Крестики",
  star: "Звёзды",
  bolt: "Молнии",
  skull: "Черепа",
  flower: "Цветы",
  butterfly: "Бабочки",
  smile: "Смайлики",
  dollar: "Доллары",
  hitmarker: "Хитмаркеры",
});

export const BLOOD_SHEETS = Object.freeze([
  sheet("game", "Как в игре", "Штатный лист кровяной пыли, только цвет свой.", {
    game: true,
  }),
  sheet("splat", "Кляксы", "Крупные пятна с брызгами по краю.", {
    animated: true,
  }),
  sheet("drops", "Капли", "Редкие тяжёлые капли — как из пипетки.", {
    animated: true,
  }),
  sheet("mist", "Туман", "Мягкие клубы без капель — как туман у раны.", {
    animated: true,
  }),
  sheet("shards", "Осколки", "Острые обломки — стекло или лёд.", {
    animated: true,
  }),
  ...Object.keys(IMPACT_PICTURE_SHAPES).map((id) =>
    sheet(id, SHEET_GLYPH_LABELS[id] || id, "Значок вместо капель.", {
      glyph: id,
    }),
  ),
  sheet(
    "upload",
    "Своя картинка",
    "PNG с прозрачным фоном летит вместо капель.",
    {
      upload: true,
    },
  ),
]);

export const BLOOD_SHEET_IDS = Object.freeze(
  BLOOD_SHEETS.map((item) => item.id),
);
const sheetById = new Map(BLOOD_SHEETS.map((item) => [item.id, item]));
export const findBloodSheet = (id) => sheetById.get(String(id || "")) || null;

/* Лист брызг в игре: сетка 4×4 на квадрате 512, восемь mip — как у штатного. */
export const BLOOD_SHEET_LAYOUT = Object.freeze({
  width: 512,
  height: 512,
  mipLevels: 8,
  format: "DXT5",
});
export const BLOOD_SHEET_GRID = Object.freeze({ columns: 4, rows: 4 });

/*
 * Готовые эффекты игры.
 *
 * Отобраны по живому ядру Legacy (964 правила) и клоунскому словарю: только
 * одноразовые правила (`NumLoops = 0` — зацикленные игра по таблице крови не
 * запускает вовсе) и только те, чьи эволюции код крови умеет выставить
 * (`LOD`, `angle`, `size`): правило, ждущее `speed` или `impulse`, в точке
 * попадания осталось бы пустым.
 *
 * `scale` — множитель размера, с которым эффект соразмерен человеку: эффекты
 * попадания пули (`bul_*`) сделаны под этот масштаб сами, а поломки предметов
 * и взрывы приходится ужимать. `weight` — сколько эмиттеров и света несёт
 * правило: в перестрелке таких эффектов десятки разом, и тяжёлые подписаны.
 * `tint` — есть ли смысл красить: купюры и фишки цветные сами по себе.
 * `file` — чужой словарь, если правило не в ядре (`IMPACT_DONOR_FILES`).
 */
export const IMPACT_TEMPLATE_GROUPS = Object.freeze([
  Object.freeze({ id: "particles", label: "Понятные" }),
  Object.freeze({ id: "clown", label: "Majestic" }),
  Object.freeze({ id: "fire", label: "Огонь" }),
  Object.freeze({ id: "electric", label: "Молнии" }),
  Object.freeze({ id: "shapes", label: "Искры и формы" }),
  Object.freeze({ id: "objects", label: "Предметы" }),
]);

const template = (id, label, description, rule, extra = {}) =>
  Object.freeze({
    id,
    label,
    description,
    rule,
    group: "particles",
    scale: 1,
    weight: "light",
    tint: true,
    file: null,
    /* Часть правила: только названные частицы. Так из клоунской пули
       получаются отдельные «линия», «цветы» и «звёзды», а из клоунской
       вспышки — «значки», «клубы дыма» и «клякса-вспышка». */
    keep: null,
    /* Предел длительности выброса, секунды: струя воды в шесть секунд на
       каждую пулю — это фонтан, а не попадание. */
    maxDuration: 1.2,
    /* Множитель непрозрачности кадров цвета донора, поверх ползунка слоя
       (помощник обрезает итог единицей). Единица — как в игре. */
    alpha: 1,
    /* Множитель РАЗМЕРА частиц без разлёта (`ptxEmitterRule:m_sizeScalarKFP`
       у эмиттеров клона; потолок помощника — 8). Мелкие предметы у игры
       миллиметровые — монеты 2 мм, обрывки бумаги 1 см: так они задуманы для
       поломки предмета на расстоянии, а на человеке их не разглядеть
       (владелец, 18.10.2026: «Монеты, Листья, Бумага почти не видно»).
       `scale` растит и размер, и дальность разлёта, `size` — только размер. */
    size: 1,
    /* Частицы донора игра гасит над водой, и на суше их не видно вовсе:
       `ptxu_ZCull` режим 1 (гасить выше высоты) от уровня воды (пространство
       3). Так настроены только подводные правила ядра: все 33 частицы с этой
       парой — пузыри, муть, следы акул и подлодок (ядро Legacy, 31.10.2026).
       Слой получает режим 0 — как у искр и пламени `scrape_metal`,
       `veh_plane_*`, которые игра рисует на суше: гасить только под водой.
       Под водой игра всё равно берёт другое правило записи bloodfx
       (`fxSystemUnderwater` штатное). Предпросмотр окна этого поведения не
       считает: там такой донор виден и без правки. */
    openAir: false,
    ...extra,
  });

/* Клоунские правила — общие поля их частей. */
const CLOWN = Object.freeze({
  group: "clown",
  file: "scr_rcbarry2",
  weight: "light",
});

/* Дымка клоуна — только дым: свечение появления в ней пятиметровое. */
const HAZE_SMOKE = Object.freeze(["scr_clown_death_core", "scr_clown_appears_spawn"]);

/* Огненный шар молотова без осколков бутылки: огонь, ядро, искры, свет. */
const MOLOTOV_FIRE = Object.freeze([
  "exp_air_mol_exp",
  "exp_air_mol_fire",
  "exp_grd_mol_sparks",
  "exp_grd_mol_glow_lit",
]);
/* Огонь у раны — то же пламя без искр: они разлетаются на метры. */
const MOLOTOV_FLAME = Object.freeze([
  "exp_air_mol_exp",
  "exp_air_mol_fire",
  "exp_grd_mol_glow_lit",
]);

export const IMPACT_TEMPLATES = Object.freeze([
  /* Понятные: то, что просят чаще всего, — дым, искры, вода. Отобраны те,
     что на человеке читаются как попадание (владелец, 23.09.2026): резиновая
     пыль, кольцо, вспышка, звезда и снег были слишком слабы или велики. */
  template(
    "smoke-dark",
    "Тёмный дым",
    "Густой чёрный клуб — как от короткого замыкания.",
    "ent_dst_electrical",
    { preview: "smoke", colour: "#475569" },
  ),
  template(
    "smoulder",
    "Тление",
    "Тонкий дымок, который тянется из раны.",
    "fire_ped_smoulder",
    { preview: "smoke", colour: "#cbd5e1" },
  ),
  template("steam", "Пар", "Короткий выброс пара.", "ent_brk_steam_burst", {
    preview: "smoke",
    colour: "#f1f5f9",
  }),
  template(
    "sparks",
    "Искры",
    "Сноп искр со вспышкой — как от пули по металлу.",
    "bul_carmetal",
    {
      preview: "sparks",
      colour: "#ffb347",
      /* Без клуба дыма и зубчатого пятна донора: от них была «мыльная» плитка. */
      keep: ["bul_carmetal_sparks", "bul_carmetal_impact"],
      size: 2.5,
    },
  ),
  template(
    "dust",
    "Пыль и крошка",
    "Бетонная пыль с осколками — как от пули по стене.",
    "bul_concrete",
    { preview: "dust", colour: "#d6d3d1" },
  ),
  template(
    "water",
    "Вода",
    "Всплеск и брызги воды — как от пули по воде.",
    "bul_water",
    { preview: "water", colour: "#bfe3ff" },
  ),
  /* Majestic: клоунские правила из словаря миссии Барри — из них собраны
     все чужие паки: «в тело значки и дым, в голову цветы». Сначала части —
     их складывают как хотят, — потом правила целиком. */
  template(
    "clown-signs",
    "Значки",
    "Восклицания и вопросы разлетаются в стороны — как в тело у Majestic.",
    "muz_clown",
    { ...CLOWN, preview: "clown", colour: "#f472b6", keep: ["muz_clown_sym"] },
  ),
  template(
    "clown-burst",
    "Клякса-вспышка",
    "Вспышка-клякса за значками: свечение и два зубчатых листа.",
    "muz_clown",
    {
      ...CLOWN,
      preview: "flash",
      colour: "#fb7185",
      keep: ["muz_clown_flare", "muz_clown_core", "muz_clown_glow_lit"],
    },
  ),
  template(
    "clown-line",
    "Линия",
    "Лента, которая вылетает из раны и вьётся — та самая линия из паков.",
    "scr_clown_bul",
    {
      ...CLOWN,
      preview: "flowers",
      colour: "#f9a8d4",
      keep: ["scr_clown_bul_tendrils"],
      maxDuration: 2.25,
    },
  ),
  template(
    "clown-flowers",
    "Цветы",
    "Четыре цветка разлетаются в стороны — как в голову у Majestic.",
    "scr_clown_bul",
    {
      ...CLOWN,
      preview: "flowers",
      colour: "#f9a8d4",
      keep: ["scr_clown_bul_flowers"],
    },
  ),
  template(
    "clown-stars",
    "Звёзды",
    "Россыпь звёзд со свечением.",
    "scr_clown_bul",
    {
      ...CLOWN,
      preview: "star",
      colour: "#fde68a",
      keep: ["scr_clown_bul_stars", "scr_clown_bul_glow"],
    },
  ),
  /* Одно свечение клоунской пули — без звёзд, цветов и лент: ореол в
     полметра–метр у раны, который светит сам (кадры эмиссии донора до 11).
     Так собраны попадания пака «Новые эффекты» (ТЗ 10.10.2026, задача 13):
     в его bloodfx.dat каждая запись, вход и выход, ведёт на `scr_clown_bul`,
     от которого оставлено одно это свечение голубым #9dcbd9. Длительность —
     правила целиком (2,25 с): свечение рождается в первую сотую его доли, и
     при обрезке до 1,2 с ореолов вылетало бы вдвое меньше. Непрозрачность —
     как в паке: у донора альфа растёт 0 → 0,5 → 1 к середине жизни, у пака
     она единица с первого кадра; ×2 даёт полную уже с десятой доли. */
  template(
    "clown-glow",
    "Свечение",
    "Мягкий светящийся ореол у раны — без звёзд, цветов и брызг.",
    "scr_clown_bul",
    {
      ...CLOWN,
      preview: "glow",
      colour: "#9dcbd9",
      keep: ["scr_clown_bul_glow"],
      maxDuration: 2.25,
      alpha: 2,
    },
  ),
  template(
    "clown-muzzle",
    "Звёзды и дым",
    "Клоунская вспышка целиком: значки, дым, клякса и свечение — как в тело у Majestic.",
    "muz_clown",
    { ...CLOWN, preview: "clown", colour: "#f472b6", weight: "medium" },
  ),
  template(
    "clown-bullet",
    "Цветы и ленты",
    "Клоунская пуля целиком: цветы, звёзды, ленты и свечение — как в голову у Majestic.",
    "scr_clown_bul",
    {
      ...CLOWN,
      preview: "flowers",
      colour: "#f9a8d4",
      weight: "medium",
      maxDuration: 2.25,
    },
  ),
  template(
    "haze",
    "Дымка",
    "Большое мягкое облако со свечением — «дымка» из паков.",
    "scr_clown_appears",
    {
      preview: "haze",
      colour: "#a5f3fc",
      group: "clown",
      file: "scr_rcbarry2",
      weight: "medium",
      scale: 0.35,
      /* Без «магического» свечения появления (оно в пять метров): дымка —
         это клубы розового дыма у раны. */
      keep: HAZE_SMOKE,
    },
  ),
  template(
    "clown-death",
    "Ленты и дым",
    "Клуб дыма с лентами и искрами.",
    "scr_clown_death",
    {
      preview: "haze",
      colour: "#c4b5fd",
      group: "clown",
      file: "scr_rcbarry2",
      weight: "medium",
      scale: 0.6,
    },
  ),
  /* Огонь: от короткой вспышки до струи пламени. */
  /* Огонь на ране — огненный шар молотова в малом масштабе и без осколков
     бутылки (`keep`): штатный `ent_dst_elec_fire` — язычок в десять
     сантиметров, на человеке его не видно. */
  template(
    "fire",
    "Огонь",
    "Короткая вспышка огня у раны — без осколков.",
    "exp_air_molotov",
    {
      preview: "fire",
      colour: "#fb923c",
      group: "fire",
      scale: 0.14,
      weight: "medium",
      keep: MOLOTOV_FLAME,
    },
  ),
  template(
    "flame-jet",
    "Струя пламени",
    "Язык огня, как из огнемёта, — на секунду.",
    "ent_sht_flame",
    {
      preview: "fire",
      colour: "#f97316",
      group: "fire",
      scale: 0.7,
      weight: "medium",
    },
  ),
  template(
    "fireball",
    "Огненный шар",
    "Вспышка коктейля Молотова в воздухе.",
    "exp_air_molotov",
    {
      preview: "explosion",
      colour: "#fdba74",
      group: "fire",
      scale: 0.3,
      weight: "heavy",
      keep: MOLOTOV_FIRE,
    },
  ),
  /* Молнии: дуги, искры и разряды. */
  template(
    "electric",
    "Молния",
    "Электрические дуги и свечение — разряд в точке попадания.",
    "exp_xs_mine_emp",
    {
      preview: "electric",
      colour: "#7dd3fc",
      group: "electric",
      /* Дуги и вспышка ЭМИ-мины Arena War: настоящая молния игры, а не серый
         клубок от шокера (у `bul_stungun_metal` дуги живут по десятой доле
         секунды и в кадре почти не бывают). Мина рассчитана на семь метров,
         у раны — десять сантиметров: размер ужат, дуги укрупнены. */
      keep: ["exp_xs_mine_emp_sparks", "exp_xs_mine_emp_glow_dots"],
      scale: 0.1,
      size: 8,
    },
  ),
  template(
    "electric-burst",
    "Разряд",
    "Крупный электрический разряд с искрами и свечением.",
    "ent_sht_electrical_box",
    {
      preview: "electric",
      colour: "#93c5fd",
      group: "electric",
      scale: 1,
      weight: "medium",
      keep: [
        "ent_sht_elecbox_arcs_sp",
        "ent_sht_elecbox_sparks_sp",
        "ent_sht_elecbox_glow_lit_sp",
      ],
    },
  ),
  template(
    "crackle",
    "Треск",
    "Дуги с россыпью долгих искр.",
    "ent_amb_elec_crackle_sp",
    {
      preview: "electric",
      colour: "#bae6fd",
      group: "electric",
      keep: [
        "ent_amb_elec_crackle_arcs",
        "ent_amb_elec_crackle_sparks",
        "ent_amb_elec_crackle_glow_lit",
      ],
      size: 1.5,
    },
  ),
  /* Предметы: цветные сами по себе, красить их незачем. */
  template("money", "Купюры", "Разлетающиеся банкноты.", "ent_brk_banknotes", {
    preview: "money",
    colour: "#6ee787",
    tint: false,
    group: "objects",
    size: 1.5,
  }),
  template("coins", "Монеты", "Россыпь монет.", "ent_brk_coins", {
    preview: "coins",
    colour: "#fcd34d",
    tint: false,
    group: "objects",
    size: 8,
    scale: 1.3,
  }),
  template(
    "chips",
    "Фишки казино",
    "Цветные фишки казино.",
    "ent_dst_casino_chips",
    {
      preview: "chips",
      colour: "#f472b6",
      tint: false,
      group: "objects",
      keep: ["ent_dst_casino_chips"],
      size: 1.5,
    },
  ),
  template("feathers", "Перья", "Перья разлетаются в стороны.", "ent_sht_feathers", {
    preview: "feathers",
    colour: "#f8fafc",
    group: "objects",
    keep: ["ent_sht_feathers"],
    size: 3,
  }),
  template("candy", "Конфеты", "Разноцветные драже.", "ent_dst_gen_gobstop", {
    preview: "candy",
    colour: "#fb7185",
    tint: false,
    group: "objects",
  }),
  template(
    "leaves",
    "Листья",
    "Сорванные листья.",
    "ent_brk_tree_leaves",
    {
      preview: "leaves",
      colour: "#86efac",
      group: "objects",
      keep: ["ent_brk_tree_leaves"],
      size: 1.5,
    },
  ),
  template("paper", "Бумага", "Обрывки бумаги.", "bul_paper", {
    preview: "paper",
    colour: "#f1f5f9",
    group: "objects",
    keep: ["bul_paper_debris"],
    size: 8,
    scale: 1.6,
  }),

  /* Искры и формы (18.10.2026, владелец: «кружочки, кольца, искры»): чёткие
     листы самой игры — кружки-боке, настоящие искры и пузырьки-колечки, а не
     серые клубы дыма. Всё — одноразовые правила ядра, без чужих словарей.
     Кольцо ударной волны (`ptfx_model_shockwave` у гранат и мин) не взято: у
     его сетки единицы не сходятся с размером частицы — кольцо выходит в сотни
     метров, а проверить, каким его рисует игра, без запуска GTA нельзя. */
  template(
    "sparks-bokeh",
    "Искры и кружки",
    "Искры веером и светящиеся кружки — как от удара по металлу.",
    "bang_carmetal",
    {
      preview: "sparks",
      colour: "#ffb347",
      group: "shapes",
      keep: ["bang_carmetal_sparks", "bang_carmetal_bokeh"],
      scale: 0.5,
      size: 2,
    },
  ),
  template(
    "orbs",
    "Огоньки",
    "Светящиеся шарики разлетаются и гаснут — кружки-боке игры.",
    "bang_hydraulics",
    {
      preview: "sparks",
      colour: "#fdba74",
      group: "shapes",
      keep: ["bang_hydraulics_bokeh"],
      size: 3,
    },
  ),
  template(
    "bubbles",
    "Пузырьки",
    "Прозрачные пузырьки разлетаются и всплывают.",
    "veh_sub_crush",
    {
      preview: "bubbles",
      colour: "#bae6fd",
      group: "shapes",
      keep: ["veh_sub_crush_bubbles_l", "veh_sub_crush_bubbles"],
      size: 7,
      scale: 0.5,
      /* Владелец, 31.10.2026: пузырьки в теле не видны. Пузыри подлодки игра
         рисует только под водой. */
      openAir: true,
    },
  ),
]);

const templateById = new Map(IMPACT_TEMPLATES.map((item) => [item.id, item]));
export const findImpactTemplate = (id) =>
  templateById.get(String(id || "")) || null;

/*
 * Части эффекта — словами человека.
 *
 * Правило игры состоит из частиц с техническими именами (`muz_clown_sym`,
 * `blood_head_seg`), а человек видит их как «значки», «ленту-кляксу», «пыль».
 * Здесь подписи тем частицам, которые встречаются в каталоге; остальным
 * подпись даёт лист, которым они нарисованы (`impactPartLabel`).
 */
const PART_LABELS = Object.freeze({
  muz_clown_sym: "Значки",
  muz_clown_smoke: "Клубы дыма",
  muz_clown_flare: "Вспышка-клякса",
  muz_clown_core: "Ядро вспышки",
  muz_clown_glow_lit: "Свечение",
  scr_clown_bul_tendrils: "Линия",
  scr_clown_bul_flowers: "Цветы",
  scr_clown_bul_stars: "Звёзды",
  scr_clown_bul_glow: "Свечение",
  scr_clown_appears_glow: "Свечение",
  scr_clown_appears_spawn: "Струйки дыма",
  scr_clown_death_core: "Клуб дыма",
  scr_clown_death_trails: "Ленты",
  scr_clown_death_fizzle: "Искорки",
  blood_head_seg: "Лента-клякса",
  blood_entry_blood_dust: "Пыль",
  blood_dust: "Пыль",
  blood_shot_dust: "Пыль",
  blood_throat_dust: "Пыль",
  blood_squib: "Мазки",
  blood_headshot_squib: "Мазки",
  blood_spray_dir: "Струя",
  blood_throat_spray: "Струя",
  blood_drops: "Капли",
  blood_throat_blood: "Капли",
  blood_entry_blood_spray: "Брызги",
  blood_shotgun_spray: "Брызги",
  blood_shotgun_squib: "Всплеск",
  td_blood_nose: "Дымка",
  shotgun_ring_SPAWN: "Картинка",
});

const TEXTURE_LABELS = Object.freeze([
  [/glow|flare/i, "Свечение"],
  [/star/i, "Звёзды"],
  [/smoke|steam|cig|mist|billow|wispy/i, "Дым"],
  [/fire|flame|ember|explosion/i, "Огонь"],
  [/spark/i, "Искры"],
  [/ribbon/i, "Лента"],
  [/debris|rubble|shard|glass/i, "Обломки"],
  [/water|splash|jet|gloop|drip/i, "Брызги"],
  [/banknote|coin|chip|feather|leaf|paper|object/i, "Предметы"],
]);

/** Подпись части: по имени частицы или по её листу. */
export function impactPartLabel(particle, texture = null) {
  if (PART_LABELS[particle]) return PART_LABELS[particle];
  for (const [pattern, label] of TEXTURE_LABELS)
    if (pattern.test(String(texture || ""))) return label;
  return "Частицы";
}

/*
 * Готовые картинки.
 *
 * Самые ходовые эффекты у игроков RP-серверов — не частицы, а значки,
 * всплывающие в точке попадания: сердечки, крестики, звёзды, черепа. Здесь
 * только их список; сами контуры — в `pictures.js`, и рисуют из них оба: окно
 * мастерской — на холсте, установщик — в текстуру клона. `upload` — картинка
 * человека, её байты приносит окно.
 */
export const IMPACT_PICTURES = Object.freeze([
  Object.freeze({ id: "heart", label: "Сердце" }),
  Object.freeze({ id: "cross", label: "Крестик" }),
  Object.freeze({ id: "star", label: "Звезда" }),
  Object.freeze({ id: "bolt", label: "Молния" }),
  Object.freeze({ id: "skull", label: "Череп" }),
  Object.freeze({ id: "flower", label: "Цветок" }),
  Object.freeze({ id: "butterfly", label: "Бабочка" }),
  Object.freeze({ id: "smile", label: "Смайлик" }),
  Object.freeze({ id: "dollar", label: "Доллар" }),
  Object.freeze({ id: "hitmarker", label: "Хитмаркер" }),
  Object.freeze({ id: "upload", label: "Своя картинка" }),
]);

export const IMPACT_PICTURE_IDS = Object.freeze(
  IMPACT_PICTURES.map((item) => item.id),
);

/** Пределы ползунков слоя и зоны. */
export const IMPACT_LIMITS = Object.freeze({
  /* Прозрачность ниже пятой части в игре уже не видно — это «без эффекта»
     другим способом, и для него есть своя плитка. */
  opacity: Object.freeze({ min: 0.2, max: 1 }),
  amount: Object.freeze({ min: 0, max: 1 }),
  count: Object.freeze({ min: 1, max: 6 }),
  /*
   * Своя картинка (задача 5 ТЗ 07.10.2026): сколько секунд держится,
   * скорость вращения (°/с, минус — против часовой) и случайный наклон, с
   * которым она появляется (± градусов).
   */
  duration: Object.freeze({ min: 0.2, max: 5 }),
  spin: Object.freeze({ min: -720, max: 720 }),
  tilt: Object.freeze({ min: 0, max: 180 }),
});

/*
 * Сколько держится картинка «как было», в секундах игры: срок жизни частицы
 * 0,75…0,95 с её собственного времени, а у донора оно идёт в полтора раза
 * быстрее (темп события 1,5) — 0,57 с на часах.
 */
export const CUSTOM_DURATION_DEFAULT = 0.57;

/*
 * Дальность зоны.
 *
 * `near` — размер вблизи (базовые кадры размера эмиттеров), `far` — вдали
 * (кадры эволюции LOD, которые игра включает с сорока метров), `reach` —
 * с какого расстояния эффект ещё виден (штатная кровь гаснет на 150 м; для
 * снайперской дуэли этого мало). Единица и 150 — как в игре.
 */
export const IMPACT_DISTANCE = Object.freeze([
  Object.freeze({
    id: "near",
    label: "Вблизи",
    hint: "Размер в упор: меньше — не закрывает прицел",
    min: 0.25,
    max: 3,
    fallback: 1,
  }),
  Object.freeze({
    id: "far",
    label: "Вдали",
    hint: "Размер за 40 м: игра и сама увеличивает брызги вдали в три-четыре раза",
    min: 0.25,
    max: 4,
    fallback: 1,
  }),
  Object.freeze({
    id: "reach",
    label: "Видно до",
    hint: "Дальше этого расстояния эффект не рисуется вовсе",
    min: 50,
    max: 600,
    fallback: 150,
    unit: "м",
  }),
]);

export const DEFAULT_IMPACT_DISTANCE = Object.freeze(
  Object.fromEntries(IMPACT_DISTANCE.map((item) => [item.id, item.fallback])),
);

/** Расстояние, с которого игра считает эффект «вдали» (LodEvoDistanceMax). */
export const IMPACT_FAR_METRES = 40;

export const impactDistanceChanged = (distance) =>
  IMPACT_DISTANCE.some(
    (item) => (distance?.[item.id] ?? item.fallback) !== item.fallback,
  );

/*
 * Как вылетает эффект.
 *
 * Эффекты попадания разлетаются по-разному: кровь бьёт короткой струёй и
 * падает, искры веером летят далеко, дым встаёт и висит. Вид задаёт правило
 * игры, а эти множители — насколько его поведение сдвинуть: единица — как в
 * игре. В клон правила они уходят множителями кадров эмиттеров
 * (`tune.scales`, помощник RPF), в окне — той же долей в симуляцию выброса.
 *
 * Разлёт — это размер области, КУДА летят частицы (у правил игры она стоит
 * перед раной в десятке сантиметров): шире область — шире веер. Падение —
 * множитель ускорений частицы: тяжести у капель, всплытия у дыма.
 */
export const IMPACT_MOTION = Object.freeze([
  Object.freeze({
    id: "count",
    label: "Количество",
    hint: "Сколько частиц за попадание",
    min: 0.25,
    max: 4,
    /* У картинки число задаётся штуками — своим ползунком. */
    kinds: Object.freeze(["blood", "template"]),
  }),
  Object.freeze({
    id: "speed",
    label: "Скорость вылета",
    hint: "Как быстро и далеко летят от раны",
    min: 0.25,
    max: 3,
    props: Object.freeze(["ptxEmitterRule:m_speedScalarKFP"]),
  }),
  Object.freeze({
    id: "spread",
    label: "Разлёт",
    hint: "Узкая струя или широкий веер",
    min: 0.25,
    max: 3,
    props: Object.freeze([
      "ptxTargetDomain:m_sizeOuterKFP",
      "ptxTargetDomain:m_sizeInnerKFP",
    ]),
  }),
  Object.freeze({
    id: "gravity",
    label: "Падение",
    hint: "0% — парят, больше — падают камнем",
    min: 0,
    max: 3,
    props: Object.freeze(["ptxEmitterRule:m_accnScalarKFP"]),
    /* Значок-картинка висит у раны: тянуть его вниз нечему. */
    kinds: Object.freeze(["blood", "template"]),
  }),
  Object.freeze({
    id: "life",
    label: "Время жизни",
    hint: "Сколько частицы держатся в воздухе",
    min: 0.25,
    max: 3,
    props: Object.freeze(["ptxEmitterRule:m_particleLifeKFP"]),
  }),
]);

/** Множители, которые есть у вида эффекта. */
export const impactMotionFor = (kind) =>
  IMPACT_MOTION.filter((item) => !item.kinds || item.kinds.includes(kind));

export const IMPACT_MOTION_IDS = Object.freeze(
  IMPACT_MOTION.map((item) => item.id),
);

/** Поведение «как в игре»: все множители — единица. */
export const DEFAULT_IMPACT_MOTION = Object.freeze(
  Object.fromEntries(IMPACT_MOTION_IDS.map((id) => [id, 1])),
);

/** Отличается ли поведение от игрового. */
export const impactMotionChanged = (motion) =>
  IMPACT_MOTION_IDS.some((id) => (motion?.[id] ?? 1) !== 1);

/*
 * КУДА ЛЕТИТ ЭФФЕКТ
 *
 * У каждого эмиттера правила есть область цели (`ptxTargetDomain`) — место,
 * куда он гонит частицы. У штатных брызг крови она стоит в полуметре от раны
 * строго наружу; у струи и капель — на своём расстоянии по той же оси. То
 * есть направление у эффекта есть всегда, просто до сих пор его было нечем
 * тронуть: ползунки «разлёт» и «скорость» меняют ширину веера и его длину, а
 * не сторону.
 *
 * Здесь сторона задаётся точкой на кадре: человек тянет метку от раны туда,
 * куда хочет, и видит это на фигуре. Ноль — как в игре, и метку можно убрать
 * одним нажатием: тогда брызги снова летят от раны наружу.
 *
 * В клон это уходит парой углов (`tune.aim`): `pitch` отклоняет вектор цели
 * от его собственной оси, `yaw` вращает отклонение вокруг неё. Длина вектора
 * не трогается — у разных эмиттеров она разная, и своя у каждого остаётся.
 */
export const DEFAULT_IMPACT_DIRECTION = Object.freeze({ x: 0, y: 0 });

/** Насколько далеко метку можно оттащить: дальше — уже не «вбок», а «назад». */
export const IMPACT_DIRECTION_LIMIT = 1;

/** Сколько градусов от оси даёт полный размах метки. */
const MAX_AIM_PITCH = 75;

/** Сдвинут ли прицел с «как в игре». */
export const impactDirectionChanged = (direction) =>
  Math.abs(direction?.x ?? 0) > 0.001 || Math.abs(direction?.y ?? 0) > 0.001;

/**
 * Метка на кадре → углы прицела для клона.
 *
 * Экран плоский, а прицел объёмный: длина сдвига становится отклонением от
 * оси, направление сдвига — поворотом этого отклонения. Ось экрана `y`
 * растёт вниз, ось эффекта — вверх, поэтому знак меняется здесь, один раз.
 */
export function impactAim(direction) {
  const x = clamp(Number(direction?.x) || 0, -1, 1);
  const y = clamp(Number(direction?.y) || 0, -1, 1);
  const reach = Math.min(1, Math.hypot(x, y));
  if (reach < 0.001) return null;
  /* `-0` — законное число и незаконная подпись: в коде обмена и в ключе
     облика оно выглядит как другое значение, хотя это тот же ноль. */
  return {
    yaw: round3((Math.atan2(-y, x) * 180) / Math.PI) || 0,
    pitch: round3(reach * MAX_AIM_PITCH),
  };
}

/*
 * НАПРАВЛЕНИЕ ВЫЛЕТА — ОДНИМ СЛОВОМ (18.10.2026, блок «Настройка вылета»).
 *
 * Метку на фигуре тянут пальцем, а в панели сторону выбирают словом: «от
 * попадания» — как в игре (наружу от раны), «вверх» — веер поднимается над
 * раной, «по пуле» — туда, куда летела пуля: из выходного отверстия, за спиной.
 * Это те же два поля слоя — сторона (`placement`) и метка (`direction`), —
 * ничего нового в проект и в игру не уезжает: клон получает `tune.aim` и
 * правило нужной стороны, как и от метки. Метка, оттянутая куда-то ещё,
 * называется «своё»: панель не выбирает ни одно слово.
 */
export const IMPACT_LAUNCH_DIRECTIONS = Object.freeze([
  Object.freeze({
    id: "hit",
    label: "От попадания",
    description: "Наружу от раны, как у игры.",
  }),
  Object.freeze({
    id: "up",
    label: "Вверх",
    description: "Веер поднимается над раной.",
  }),
  Object.freeze({
    id: "bullet",
    label: "По пуле",
    description: "Туда, куда летела пуля: из выходного отверстия, за спиной.",
  }),
]);

/** Метка слова «вверх»: до края вверх — отклонение от оси на полный размах. */
const LAUNCH_UP = Object.freeze({ x: 0, y: -1 });

/** Какое слово описывает слой: `hit`, `up`, `bullet` или `custom` (метка где-то ещё). */
export function layerLaunchDirection(layer) {
  const moved = impactDirectionChanged(layer?.direction);
  if (layerPlacement(layer) === "back") return moved ? "custom" : "bullet";
  if (!moved) return "hit";
  return layer.direction.x === LAUNCH_UP.x && layer.direction.y === LAUNCH_UP.y
    ? "up"
    : "custom";
}

/** Что поменять в слое, чтобы он вылетал в сторону `id` (поля `placement` и `direction`). */
export function launchDirectionChange(id) {
  if (id === "up")
    return { placement: "front", direction: { ...LAUNCH_UP } };
  if (id === "bullet")
    return { placement: "back", direction: { ...DEFAULT_IMPACT_DIRECTION } };
  return { placement: "front", direction: { ...DEFAULT_IMPACT_DIRECTION } };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function bounded(value, fallback, { min, max }, label) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new Error(`${label}: допустимо от ${min} до ${max}.`);
  return Math.round(number * 100) / 100;
}

/** Второй цвет по умолчанию: светлый — рядом с любой кровью виден. */
export const DEFAULT_SECOND_COLOUR = "#f8fafc";

/** Слой зоны «как в игре»: штатная кровь спереди. */
export function defaultImpactLayer(zoneId, kind = "blood") {
  return {
    kind,
    /* Сторона: спереди — из раны, сзади — из выходного отверстия. */
    placement: "front",
    /* Какая кровь: штатная, с лентой, большая, маленькая, капли, дымка. */
    variant: "game",
    colour: VANILLA_BLOOD_COLOUR,
    /* Режим цвета и второй цвет для «двух цветов». */
    colourMode: "one",
    colour2: DEFAULT_SECOND_COLOUR,
    /* Красить ли шаблон или картинку в `colour`. У крови цвет — её суть, и
       выключателя у неё нет. */
    tinted: false,
    /* Светится ли эффект сам по себе (кадры эмиссии). */
    glow: false,
    opacity: 1,
    /* Сила: у крови — брызги, у шаблона и картинки — размер. Половина — как
       в игре. */
    amount: 0.5,
    template: "sparks",
    picture: "heart",
    /* Сколько картинок вылетает за одно попадание. */
    count: zoneId === "head" ? 1 : 2,
    /* Картинка: сколько держится (с), как крутится (°/с) и наклон (±°). */
    duration: CUSTOM_DURATION_DEFAULT,
    spin: 0,
    tilt: 0,
    /* Лист брызг крови: штатный, нарисованный, значок или своя картинка. */
    sheet: "game",
    /* Части эффекта по именам частиц: спрятана ли, свой ли цвет. */
    parts: {},
    motion: { ...DEFAULT_IMPACT_MOTION },
    direction: { ...DEFAULT_IMPACT_DIRECTION },
  };
}

/*
 * Новая зона пуста: человек заходит, выбирает голову или тело и сам решает,
 * что туда положить — кровь, эффект игры или картинку (владелец, 23.09.2026).
 * Выключенная пустая зона — «как в игре»; включённая пустая — «без эффекта».
 */
export function defaultImpactZone(_id) {
  return {
    enabled: false,
    layers: [],
    distance: { ...DEFAULT_IMPACT_DISTANCE },
  };
}

const LAYER_FIELDS = Object.freeze(Object.keys(defaultImpactLayer("head")));
const ZONE_FIELDS = Object.freeze(["enabled", "layers", "distance"]);
/* Поля, которых у слоя прежних схем не было. */
const LAYER_ONLY_FIELDS = Object.freeze([
  "kind",
  "sheet",
  "placement",
  "variant",
  "colourMode",
  "colour2",
  "glow",
  "parts",
]);
/*
 * Поля, которые окно больше не пишет. `sheets` — листы игры, перерисованные
 * кистью: кисть убрана вместе с разделом «Текстура» (владелец, 24.09.2026).
 * Черновик, сохранённый с ней, открывается без них — листы снова игровые.
 */
const RETIRED_LAYER_FIELDS = Object.freeze(["sheets"]);

/* Имена частиц и текстур игры — как в самих ресурсах. */
const RESOURCE_NAME = /^[A-Za-z0-9_]{1,64}$/;
/** Сколько частей у слоя можно назвать: у правила игры их не больше. */
const PART_LIMIT = 32;

/* Части: объект по именам частиц, у каждой — спрятана ли и свой ли цвет. */
function parseParts(input, label) {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input))
    throw new Error(`${label}: части эффекта — это набор по именам частиц.`);
  const parts = {};
  for (const [particle, value] of Object.entries(input)) {
    if (!RESOURCE_NAME.test(particle))
      throw new Error(`${label}: неверное имя части «${particle}».`);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${label}: часть «${particle}» — это набор настроек.`);
    const unknown = Object.keys(value).find(
      (key) => key !== "hidden" && key !== "colour",
    );
    if (unknown)
      throw new Error(`${label}: лишнее поле части «${unknown}».`);
    const part = {};
    if (value.hidden === true) part.hidden = true;
    if (value.colour !== undefined && value.colour !== null)
      part.colour = normalizeColour(value.colour);
    /* Часть без настроек не хранится: «как в игре» — это отсутствие записи. */
    if (Object.keys(part).length) parts[particle] = part;
  }
  if (Object.keys(parts).length > PART_LIMIT)
    throw new Error(`${label}: не больше ${PART_LIMIT} частей.`);
  return parts;
}

/* Поля зоны прежней схемы (один вид на зону): такая зона переводится в
   стопку из одного слоя. */
const LEGACY_ZONE_FIELDS = Object.freeze([
  "enabled",
  "kind",
  ...LAYER_FIELDS.filter((field) => !LAYER_ONLY_FIELDS.includes(field)),
]);

/* Прицел: две доли от −1 до 1. Те же правила, что у множителей — чужое поле
   и число вне пределов останавливают разбор, а не проглатываются. */
function parseDirection(input, label) {
  if (input === undefined || input === null)
    return { ...DEFAULT_IMPACT_DIRECTION };
  if (typeof input !== "object" || Array.isArray(input))
    throw new Error(`${label}: направление — это пара долей x и y.`);
  const unknown = Object.keys(input).find((key) => key !== "x" && key !== "y");
  if (unknown) throw new Error(`${label}: лишняя ось «${unknown}».`);
  const axis = (value, name) => {
    if (value === undefined || value === null) return 0;
    const number = Number(value);
    if (
      !Number.isFinite(number) ||
      number < -IMPACT_DIRECTION_LIMIT ||
      number > IMPACT_DIRECTION_LIMIT
    )
      throw new Error(
        `${label}: направление по ${name} — от -${IMPACT_DIRECTION_LIMIT} до ${IMPACT_DIRECTION_LIMIT}.`,
      );
    return Math.round(number * 100) / 100;
  };
  return { x: axis(input.x, "x"), y: axis(input.y, "y") };
}

function parseMotion(input, label) {
  if (input === undefined || input === null)
    return { ...DEFAULT_IMPACT_MOTION };
  if (typeof input !== "object" || Array.isArray(input))
    throw new Error(`${label}: поведение частиц — это набор множителей.`);
  const unknown = Object.keys(input).find(
    (key) => !IMPACT_MOTION_IDS.includes(key),
  );
  if (unknown) throw new Error(`${label}: лишний множитель «${unknown}».`);
  return Object.fromEntries(
    IMPACT_MOTION.map((item) => [
      item.id,
      bounded(input[item.id], 1, item, `${label}: ${item.label.toLowerCase()}`),
    ]),
  );
}

function parseDistance(input, label) {
  if (input === undefined || input === null)
    return { ...DEFAULT_IMPACT_DISTANCE };
  if (typeof input !== "object" || Array.isArray(input))
    throw new Error(`${label}: дальность — это набор чисел.`);
  const ids = IMPACT_DISTANCE.map((item) => item.id);
  const unknown = Object.keys(input).find((key) => !ids.includes(key));
  if (unknown) throw new Error(`${label}: лишнее поле дальности «${unknown}».`);
  return Object.fromEntries(
    IMPACT_DISTANCE.map((item) => [
      item.id,
      bounded(
        input[item.id],
        item.fallback,
        item,
        `${label}: ${item.label.toLowerCase()}`,
      ),
    ]),
  );
}

/** Значение из списка допустимых или умолчание; чужое — ошибка. */
function oneOf(value, fallback, allowed, label) {
  if (value === undefined || value === null) return fallback;
  const text = String(value);
  if (!allowed.includes(text)) throw new Error(`${label}: ${text}`);
  return text;
}

/** Разбирает слой; неизвестное поле — ошибка, а не «пропустим». */
export function parseImpactLayer(zoneId, input, index = 0) {
  const zone = findImpactZone(zoneId);
  const label = `${zone?.label || zoneId}, слой ${index + 1}`;
  const base = defaultImpactLayer(zoneId);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error(`${label}: слой — это набор настроек.`);
  const unknown = Object.keys(input).find(
    (key) => !LAYER_FIELDS.includes(key) && !RETIRED_LAYER_FIELDS.includes(key),
  );
  if (unknown) throw new Error(`${label}: лишнее поле «${unknown}».`);
  const kind = oneOf(
    input.kind,
    base.kind,
    IMPACT_KIND_IDS,
    "Неизвестный вид эффекта попадания",
  );
  const templateId =
    input.template === undefined ? base.template : String(input.template);
  if (!findImpactTemplate(templateId))
    throw new Error(`Неизвестный эффект игры: ${templateId}`);
  const picture =
    input.picture === undefined ? base.picture : String(input.picture);
  if (!IMPACT_PICTURE_IDS.includes(picture))
    throw new Error(`Неизвестная картинка эффекта: ${picture}`);
  const sheetId = input.sheet === undefined ? base.sheet : String(input.sheet);
  if (!findBloodSheet(sheetId))
    throw new Error(`Неизвестный лист брызг: ${sheetId}`);
  const count =
    input.count === undefined || input.count === null
      ? base.count
      : Number(input.count);
  if (
    !Number.isInteger(count) ||
    count < IMPACT_LIMITS.count.min ||
    count > IMPACT_LIMITS.count.max
  )
    throw new Error(
      `${label}: число картинок — от ${IMPACT_LIMITS.count.min} до ${IMPACT_LIMITS.count.max}.`,
    );
  return {
    kind,
    placement: oneOf(
      input.placement,
      base.placement,
      IMPACT_PLACEMENT_IDS,
      `${label}: неизвестная сторона`,
    ),
    variant: oneOf(
      input.variant,
      base.variant,
      BLOOD_VARIANT_IDS,
      "Неизвестная кровь",
    ),
    colour:
      input.colour === undefined || input.colour === null
        ? base.colour
        : normalizeColour(input.colour),
    colourMode: oneOf(
      input.colourMode,
      base.colourMode,
      IMPACT_COLOUR_MODE_IDS,
      `${label}: неизвестный режим цвета`,
    ),
    colour2:
      input.colour2 === undefined || input.colour2 === null
        ? base.colour2
        : normalizeColour(input.colour2),
    tinted: input.tinted === true,
    glow: input.glow === true,
    opacity: bounded(
      input.opacity,
      base.opacity,
      IMPACT_LIMITS.opacity,
      `${label}: прозрачность`,
    ),
    amount: bounded(
      input.amount,
      base.amount,
      IMPACT_LIMITS.amount,
      `${label}: сила эффекта`,
    ),
    template: templateId,
    picture,
    count,
    duration: bounded(
      input.duration,
      base.duration,
      IMPACT_LIMITS.duration,
      `${label}: длительность`,
    ),
    spin: bounded(input.spin, base.spin, IMPACT_LIMITS.spin, `${label}: вращение`),
    tilt: bounded(input.tilt, base.tilt, IMPACT_LIMITS.tilt, `${label}: наклон`),
    sheet: sheetId,
    parts: parseParts(input.parts, label),
    motion: parseMotion(input.motion, label),
    direction: parseDirection(input.direction, label),
  };
}

/*
 * Зона прежней схемы (вид прямо в зоне) → стопка слоёв. «Без эффекта» —
 * пустая стопка; остальное — один слой из тех же полей.
 */
function migrateLegacyZone(input) {
  const { enabled, kind, ...rest } = input;
  return {
    enabled,
    layers: kind === "none" ? [] : [{ kind, ...rest }],
  };
}

/** Разбирает настройки зоны; неизвестное поле — ошибка, а не «пропустим». */
export function parseImpactZone(id, input) {
  const base = defaultImpactZone(id);
  if (!input) return base;
  const zone = findImpactZone(id);
  if (typeof input !== "object" || Array.isArray(input))
    throw new Error(`${zone.label}: зона — это набор настроек.`);
  const legacy =
    input.kind !== undefined ||
    (input.layers === undefined &&
      Object.keys(input).some((key) => !ZONE_FIELDS.includes(key)));
  if (legacy) {
    const unknown = Object.keys(input).find(
      (key) => !LEGACY_ZONE_FIELDS.includes(key),
    );
    if (unknown) throw new Error(`${zone.label}: лишнее поле «${unknown}».`);
    return parseImpactZone(id, migrateLegacyZone(input));
  }
  const unknown = Object.keys(input).find((key) => !ZONE_FIELDS.includes(key));
  if (unknown) throw new Error(`${zone.label}: лишнее поле «${unknown}».`);
  /* Зона без поля `layers` — запись до стопок: её вид — штатная кровь одним
     слоем. Пустой список — «без эффекта»; новая зона (`defaultImpactZone`)
     пуста и выключена — «как в игре». */
  const layers =
    input.layers === undefined || input.layers === null
      ? [defaultImpactLayer(id)]
      : input.layers;
  if (!Array.isArray(layers))
    throw new Error(`${zone.label}: слои — это список.`);
  if (layers.length > IMPACT_LAYER_LIMIT)
    throw new Error(
      `${zone.label}: не больше ${IMPACT_LAYER_LIMIT} слоёв в одной зоне.`,
    );
  return {
    enabled: input.enabled === true,
    layers: layers.map((layer, index) => parseImpactLayer(id, layer, index)),
    distance: parseDistance(input.distance, zone.label),
  };
}

/** Правило-донор слоя и словарь, где оно живёт (`null` — само ядро). */
export function layerDonor(zoneId, layer) {
  if (layer.kind === "blood")
    return { effect: bloodDonor(zoneId, layer.variant), file: null };
  if (layer.kind === "template") {
    const item = findImpactTemplate(layer.template);
    return { effect: item.rule, file: item.file || null };
  }
  return { effect: customDonor(layer).effect, file: null };
}

/*
 * ЧАСТИ СЛОЯ
 *
 * Части — это частицы правила-донора: у клоунской вспышки их пять (значки,
 * клубы дыма, вспышка, ядро вспышки, свечение), у крови — пыль, мазки,
 * струя, капли. Шаблон-элемент оставляет только свои (`keep`), человек
 * прячет лишние (`parts[name].hidden`) и красит отдельные (`parts[name].colour`).
 * В игру это уходит списком оставленных частиц (`keepParticles`) и цветами
 * по частям (`partColours`); на сцене — тем же заказом.
 */

/** Части слоя по порядку правила: что за частица, каким листом нарисована. */
export function layerParts(zoneId, layer, rules = null) {
  if (layer.kind === "custom") return [];
  const { effect } = layerDonor(zoneId, layer);
  const keep = layer.kind === "template" ? findImpactTemplate(layer.template)?.keep : null;
  return ruleParticles(effect, rules)
    .filter((particle) => !keep || keep.includes(particle))
    .map((particle) => {
      const texture = ruleParticleTexture(effect, particle, rules);
      const part = layer.parts?.[particle] || {};
      return {
        particle,
        texture,
        label: impactPartLabel(particle, texture),
        hidden: part.hidden === true,
        colour: part.colour || null,
      };
    });
}

/** Части, которые останутся в игре: не спрятанные. */
export const layerKeptParts = (zoneId, layer, rules = null) =>
  layerParts(zoneId, layer, rules).filter((part) => !part.hidden);

/**
 * Сколько эмиттеров понесёт правило одной стороны зоны. Считается по
 * оставленным частям доноров: у правила игры не больше семи событий
 * (`IMPACT_EMITTER_CAP`), и стопка, которая в него не влезет, обязана быть
 * отвергнута словами до сборки, а не потеряна молча. `rules` — живая выписка
 * правил ядра игрока.
 */
export function impactZoneEmitters(zoneId, settings, placement, rules = null) {
  return placementLayers(settings, placement).reduce((total, { layer }) => {
    if (layer.kind === "custom") return total + 1;
    const { effect } = layerDonor(zoneId, layer);
    if (!ruleEventCount(effect, rules)) return total;
    /* Считаются события, чья частица оставлена: одну частицу могут рисовать
       несколько событий, и каждое — свой эмиттер правила. */
    const kept = new Set(
      layerKeptParts(zoneId, layer, rules).map((part) => part.particle),
    );
    return (
      total +
      ruleEventParticles(effect, rules).filter((name) => kept.has(name)).length
    );
  }, 0);
}

/**
 * Сколько эмиттеров станет у стороны слоя, если поставить `layer` на место
 * слоя `index` (или добавить его, когда `index` — `null`). Этим окно
 * заранее гасит плитки, с которыми правило перевалит за семь: выбрать то,
 * что уронит игру, нельзя вовсе.
 */
export function impactLayerEmitters(
  zoneId,
  settings,
  layer,
  index = null,
  rules = null,
) {
  const layers = settings?.layers || [];
  const next =
    index == null
      ? [...layers, layer]
      : layers.map((item, position) => (position === index ? layer : item));
  return impactZoneEmitters(
    zoneId,
    { ...settings, layers: next },
    layerPlacement(layer),
    rules,
  );
}

/** Влезет ли слой в правило своей стороны (см. `impactLayerEmitters`). */
export const impactLayerFits = (zoneId, settings, layer, index = null, rules = null) =>
  impactLayerEmitters(zoneId, settings, layer, index, rules) <=
  IMPACT_EMITTER_CAP;

/**
 * Новый слой вида `kind`, который влезет в правило: умолчание вида, если оно
 * помещается, иначе — тот же вид полегче (кровь меньшей силы, другой эффект
 * игры), сначала спереди, потом сзади. Не влезает ничто — `null`, и кнопка
 * «добавить» этого вида гаснет. `base` — заготовка слоя (умолчания и цвет).
 */
export function fittingImpactLayer(zoneId, settings, kind, base, rules = null) {
  const candidates =
    kind === "blood"
      ? [base.variant, ...BLOOD_VARIANTS.map((item) => item.id)].map(
          (variant) => ({ ...base, variant }),
        )
      : kind === "template"
        ? [base.template, ...IMPACT_TEMPLATES.map((item) => item.id)].map(
            (template) => ({ ...base, template }),
          )
        : [base];
  for (const placement of IMPACT_PLACEMENT_IDS)
    for (const candidate of candidates) {
      const layer = { ...candidate, placement };
      if (impactLayerFits(zoneId, settings, layer, null, rules)) return layer;
    }
  return null;
}

/** Слой, который в игре отличается от штатной крови спереди. */
export function impactLayerChanged(layer) {
  if (layer.kind !== "blood") return true;
  return (
    layerPlacement(layer) !== "front" ||
    layer.variant !== "game" ||
    layer.colourMode !== "one" ||
    layer.glow === true ||
    Object.keys(layer.parts || {}).length > 0 ||
    normalizeColour(layer.colour) !== VANILLA_BLOOD_COLOUR ||
    layer.amount !== 0.5 ||
    layer.opacity !== 1 ||
    layer.sheet !== "game" ||
    impactMotionChanged(layer.motion) ||
    impactDirectionChanged(layer.direction)
  );
}

/**
 * Меняет ли зона что-то в игре.
 *
 * Включённая штатная кровь одним слоем со штатным цветом, силой и
 * прозрачностью — это кровь игры как она есть: клонировать её незачем, и в
 * итоге установки её быть не должно. Пустая стопка — «без эффекта» — правка.
 */
export function impactZoneChanged(settings) {
  if (!settings?.enabled) return false;
  const layers = settings.layers || [];
  if (layers.length !== 1) return true;
  return (
    impactLayerChanged(layers[0]) || impactDistanceChanged(settings.distance)
  );
}

/** Есть ли у слоя картинка от человека (значок «своя картинка» или лист). */
export const layerNeedsUpload = (layer) =>
  (layer?.kind === "custom" && layer.picture === "upload") ||
  (layer?.kind === "blood" && layer.sheet === "upload");

/** Ключ картинки слоя в хранилище окна и в заказе установщика. */
export const layerPictureKey = (zoneId, index) => `${zoneId}:${index}`;

/** Цвета слоя, которые уходят в игру: один, два или радуга (от первого). */
function colourKey(layer) {
  return [layer.colourMode, layer.colour, layer.colourMode === "duo" ? layer.colour2 : ""].join(
    ":",
  );
}

/** Ключ облика слоя: слои с одинаковым ключом собираются одинаково. */
function layerAppearanceKey(zoneId, layer, pictureKey = "") {
  const motion = IMPACT_MOTION_IDS.map((id) => layer.motion?.[id] ?? 1);
  const aim = [layer.direction?.x ?? 0, layer.direction?.y ?? 0];
  const parts = Object.entries(layer.parts || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([particle, part]) =>
        `${particle}:${part.hidden ? "h" : ""}${part.colour || ""}`,
    );
  const shared = [
    layer.opacity,
    layer.amount,
    layer.glow ? "glow" : "",
    ...motion,
    ...aim,
    `parts:${parts.join(",")}`,
  ];
  if (layer.kind === "blood")
    /* Донор у головы и тела разный, поэтому кровь в ключе несёт зону. */
    return [
      "blood",
      zoneId,
      layer.variant,
      colourKey(layer),
      layer.sheet,
      layer.sheet === "upload" ? pictureKey : "",
      ...shared,
    ].join("|");
  if (layer.kind === "template")
    return [
      "template",
      layer.template,
      layer.tinted ? colourKey(layer) : "",
      ...shared,
    ].join("|");
  const motionOfPicture = [
    (layer.duration ?? CUSTOM_DURATION_DEFAULT) !== CUSTOM_DURATION_DEFAULT
      ? `duration:${layer.duration}`
      : "",
    customPictureSpins(layer) ? `spin:${layer.spin || 0}:${layer.tilt || 0}` : "",
  ].filter(Boolean);
  return [
    "custom",
    layer.picture,
    layer.picture === "upload" ? pictureKey : "",
    layer.tinted ? colourKey(layer) : "",
    layer.count,
    ...shared,
    ...motionOfPicture,
  ].join("|");
}

/**
 * Ключ облика зоны с одной стороны: зоны с одинаковым ключом делят один клон
 * правила. `pictureKeys` — отпечатки картинок слоёв по их индексу.
 */
export function impactAppearanceKey(
  zoneId,
  settings,
  pictureKeys = {},
  placement = "front",
) {
  const layers = placementLayers(settings, placement);
  if (!layers.length) return "none";
  const distance = IMPACT_DISTANCE.map(
    (item) => settings.distance?.[item.id] ?? item.fallback,
  );
  return [
    ...layers.map(({ layer, index }) =>
      layerAppearanceKey(zoneId, layer, String(pictureKeys[index] || "")),
    ),
    `distance:${distance.join(",")}`,
  ].join("||");
}

/* Сила → множители. Шкала показательная: разница между «чуть-чуть» и «как в
   игре» важнее, чем между «много» и «очень много». Половина — единица. */
const power = (base, amount) => Math.pow(base, (amount - 0.5) * 2);
const round3 = (value) => Math.round(value * 1000) / 1000;

const unit = (hex) => parseColour(hex).map((channel) => round3(channel / 255));

/*
 * Цвет крови для кадров правила.
 *
 * Кадры цвета штатной крови — тёмно-красные сами по себе (красный канал от
 * 0,15 до 0,6), и яркость брызг живёт в них. Клон сохраняет эту яркость, а от
 * выбранного цвета берёт тон и насыщенность — плюс поправку на светлоту:
 * штатный тёмно-красный образец обязан дать кровь как в игре, чёрный — тёмную,
 * белый — светлую. Отсчёт — светлота штатного образца.
 */
const VANILLA_BLOOD_VALUE =
  Math.max(...parseColour(VANILLA_BLOOD_COLOUR)) / 255;

export function bloodRuleColour(hex) {
  const channels = parseColour(hex).map((channel) => channel / 255);
  const value = Math.max(...channels, 1e-3);
  const gain = clamp(value / VANILLA_BLOOD_VALUE, 0.15, 3.2);
  return channels.map((channel) => round3((channel / value) * gain));
}

/**
 * Тон пятен крови на стенах и земле (COL_TINT записи bloodfx.dat, 0…255).
 * Штатный образец даёт штатные 50 по ведущему каналу; светлые и яркие цвета
 * остаются яркими — как розовая кровь клоуна в самой игре (206, 44, 204).
 */
export function bloodDecalTint(hex) {
  const channels = parseColour(hex).map((channel) => channel / 255);
  const value = Math.max(...channels, 1e-3);
  const lead =
    value <= VANILLA_BLOOD_VALUE
      ? 50 * (value / VANILLA_BLOOD_VALUE)
      : 50 + ((value - VANILLA_BLOOD_VALUE) / (1 - VANILLA_BLOOD_VALUE)) * 160;
  return channels.map((channel) => Math.round((channel / value) * lead));
}

/* Дальность, с которой штатная кровь ещё видна: эффекты поломки предметов
   гаснут в двадцати метрах, а стреляют друг в друга с пятидесяти. */
const IMPACT_CULL = Object.freeze({ fade: 130, cull: 150 });

/* Донор своей картинки: одноразовый выброс из точки неосвещённым спрайтом,
   который держится за кость и не вращается (правило всплеска дроби по воде). */
export const CUSTOM_DONOR = Object.freeze({
  effect: "shotgun_water",
  particle: "shotgun_ring_SPAWN",
  /* Темп частицы: правило 1 × событие 1,5 (штатное ядро Legacy). Время
     частицы — секунды игры, умноженные на него. */
  playback: 1.5,
});

/*
 * Донор картинки, которая вращается или появляется с наклоном (задача 5 ТЗ
 * 07.10.2026). Вращение в игре — поведение частицы `ptxu_Rotation`, а у
 * всплеска дроби его нет; дописать поведение частице помощник не умеет, и
 * правило без него вращаться не может. Поэтому крутящаяся картинка берёт
 * другую частицу ядра — дуги электрического треска: тот же одноразовый
 * неосвещённый спрайт с альфой (RGBA_soft), держится за кость и уже несёт
 * `ptxu_Rotation` (начальный угол и скорость, °/с, накапливается). Своё у
 * донора — свечение 16, отрыв от кости и угол ±180° — рецепт перебивает,
 * чтобы картинка выглядела так же, как неподвижная.
 *
 * Неподвижная картинка остаётся на прежнем доноре: собранное до задачи 5
 * встаёт в игру байт в байт как раньше.
 */
export const CUSTOM_SPIN_DONOR = Object.freeze({
  effect: "ent_amb_elec_crackle_sp",
  particle: "ent_amb_elec_crackle_arcs",
  /* Правило 1,1 × событие 3: время дуг бежит в 3,3 раза быстрее часов —
     и срок жизни, и скорость вращения пересчитываются на него. */
  playback: 3.3,
});

/** Крутится ли картинка (или появляется с наклоном). */
export const customPictureSpins = (layer) =>
  (Number(layer?.spin) || 0) !== 0 || (Number(layer?.tilt) || 0) !== 0;

/** Донор картинки слоя: неподвижной — всплеск дроби, крутящейся — дуги. */
export const customDonor = (layer) =>
  customPictureSpins(layer) ? CUSTOM_SPIN_DONOR : CUSTOM_DONOR;

/*
 * Срок жизни картинки во времени частицы: длительность (секунды игры) × темп
 * донора, ±0,1 с игры. Неподвижная картинка с длительностью по умолчанию —
 * прежние 0,75…0,95: собранное до задачи 5 не меняется ни на байт.
 */
function customLife(duration, donor) {
  const seconds = Number.isFinite(Number(duration))
    ? Number(duration)
    : CUSTOM_DURATION_DEFAULT;
  if (donor === CUSTOM_DONOR && seconds === CUSTOM_DURATION_DEFAULT)
    return [0.75, 0.95];
  const centre = seconds * donor.playback;
  const spread = 0.1 * donor.playback;
  return [round3(Math.max(0.05, centre - spread)), round3(centre + spread)];
}

/* Картинка в игре: лист из одного кадра. */
export const CUSTOM_TEXTURE_LAYOUT = Object.freeze({
  width: 256,
  height: 256,
  mipLevels: 7,
  format: "DXT5",
});

/**
 * Размер картинки в игре, метры (полная сторона спрайта).
 * От значка с ладонь до плаката в полроста.
 */
export const customPictureSize = (amount) =>
  round3(0.18 * Math.pow(1.1 / 0.18, clamp(amount, 0, 1)));

/*
 * Поведение → множители кадров эмиттеров. Единица не пишется: клон с
 * поведением «как в игре» не несёт ни одного лишнего множителя.
 */
function motionScales(settings, skip = []) {
  const scales = [];
  for (const item of impactMotionFor(settings.kind)) {
    if (skip.includes(item.id)) continue;
    const factor = settings.motion?.[item.id] ?? 1;
    if (!item.props || factor === 1) continue;
    for (const prop of item.props) scales.push({ prop, factor });
  }
  return scales;
}

/* Множитель количества частиц поверх собственного у вида. */
const countOf = (settings) => settings.motion?.count ?? 1;

/* Прицел клона: пара углов или ничего. «Ничего» — это «как в игре», и клон с
   таким прицелом не несёт лишнего поля. */
const aimOf = (settings) => {
  const aim = impactAim(settings.direction);
  return aim ? { aim } : {};
};

/*
 * Цвет клона: режим и цвета. У крови цвета уходят поправленными на светлоту
 * штатного образца (`bloodRuleColour`), у эффектов игры и картинок — как
 * есть. Режим «один цвет» помощник знает как `recolour`.
 */
function colourTune(layer, convert) {
  const mode = layer.colourMode || "one";
  if (mode === "duo")
    return {
      colour: convert(layer.colour),
      colour2: convert(layer.colour2 || DEFAULT_SECOND_COLOUR),
      colourMode: "duo",
    };
  if (mode === "rainbow")
    return { colour: convert(layer.colour), colourMode: "rainbow" };
  return { colour: convert(layer.colour), colourMode: "recolour" };
}

/* Свечение: кадры эмиссии у всех частиц слоя. */
const glowKeyframes = (layer) =>
  layer.glow
    ? [{ scope: "particle", prop: GLOW_PROP, values: [[...GLOW_EMISSIVE]] }]
    : [];

/*
 * Части слоя в заказе: какие частицы оставить (`null` — все, как у донора)
 * и какие покрасить своим цветом. Слой, у которого спрятано всё, — отказ
 * словами: пустое правило игра бы не заметила, а человек ждал бы эффект.
 */
function partsTune(zoneId, layer, convert, rules) {
  const parts = layerParts(zoneId, layer, rules);
  if (!parts.length) return { keepParticles: null, partColours: [] };
  const kept = parts.filter((part) => !part.hidden);
  if (!kept.length)
    throw new Error(
      `${findImpactZone(zoneId)?.label || zoneId}: у слоя спрятаны все части — нечего показывать.`,
    );
  const { effect } = layerDonor(zoneId, layer);
  const all = ruleParticles(effect, rules);
  return {
    keepParticles:
      kept.length === all.length ? null : kept.map((part) => part.particle),
    partColours: kept
      .filter((part) => part.colour)
      .map((part) => ({ particle: part.particle, colour: convert(part.colour) })),
  };
}

/*
 * Кадры цвета радуги для картинки: те же восемь ступеней тона, что строит
 * помощник для кадров донора, только яркость здесь своя — картинка белая и
 * гаснет в последней четверти жизни.
 */
export function rainbowKeyframes(alpha, offset = 0, fadeFrom = 0.72) {
  const steps = 8;
  return Array.from({ length: steps }, (_, step) => {
    const time = step / (steps - 1);
    const opacity =
      time < fadeFrom ? alpha : alpha * (1 - (time - fadeFrom) / (1 - fadeFrom));
    const hue = (time + offset) % 1;
    return [round3(time), ...hueColour(hue), round3(opacity)];
  });
}

/** Чистый тон радуги полной яркости — как `Hue` в помощнике. */
function hueColour(hue) {
  const sector = hue * 6;
  const index = Math.floor(sector) % 6;
  const fraction = sector - Math.floor(sector);
  const rising = round3(fraction);
  const falling = round3(1 - fraction);
  return [
    [1, rising, 0],
    [falling, 1, 0],
    [0, 1, rising],
    [0, falling, 1],
    [rising, 0, 1],
    [1, 0, falling],
  ][index];
}

/*
 * Подмена листа брызг у слоя крови.
 *
 * Штатный лист — нейтральная копия листа игрока под тем же именем для всех
 * слоёв. Нарисованный лист — своя текстура 4×4: организованные стили идут по
 * кадрам за жизнь частицы, значок держит один случайный кадр — сердечко не
 * должно мигать шестнадцатью сердечками.
 */
function bloodSheetSwap(layer, texture) {
  const item = findBloodSheet(layer.sheet);
  if (!item || item.game)
    return {
      texture: ASTRAL_BLOOD_SPRAY_TEXTURE,
      donorTexture: BLOOD_SPRAY_TEXTURE,
    };
  const last = BLOOD_SHEET_GRID.columns * BLOOD_SHEET_GRID.rows - 1;
  return {
    texture,
    donorTexture: BLOOD_SPRAY_TEXTURE,
    frameMin: 0,
    frameMax: item.animated ? 0 : last,
    lastFrame: last,
    loopMode: 0,
    scaledOverLife: item.animated,
    randomised: !item.animated,
  };
}

/**
 * Рецепт одного слоя: донор (и его словарь), что оставить, чем подменить
 * текстуры и как настроить. `texture` — имя текстуры слоя в ядре (картинка
 * или свой лист), если слою она нужна. Читает его помощник RPF (`layers` в
 * `effectClones`), а пишет только эта функция — окно и установщик получают
 * одно и то же. `rules` — живая выписка правил, если есть: по ней ясно,
 * какие частицы донора рисуют лист брызг.
 */
export function impactLayerRecipe(
  zoneId,
  layer,
  { texture = null, rules = null } = {},
) {
  if (layer.kind === "blood") {
    const donorEffect = bloodDonor(zoneId, layer.variant);
    const { keepParticles, partColours } = partsTune(
      zoneId,
      layer,
      bloodRuleColour,
      rules,
    );
    /* Лист брызг подменяется только тем частицам, что его рисуют: у дымки
       таких нет, и подмена ей не заказывается вовсе. */
    const drawers = ruleParticlesDrawing(donorEffect, BLOOD_SPRAY_TEXTURE, rules);
    const swap = drawers.length ? bloodSheetSwap(layer, texture) : null;
    /* Значок держит кадр: анимация листа выключается нулевой скоростью у
       частиц, которые лист рисуют, — струя и мазки листаются как прежде. */
    const holdFrame =
      swap?.randomised && layer.sheet !== "game"
        ? drawers
            .filter((particle) => !keepParticles || keepParticles.includes(particle))
            .map((particle) => ({
              scope: "particle",
              prop: "ptxu_AnimateTexture:m_animRateKFP",
              particle,
              values: [[0, 0, 0, 0, 0]],
            }))
        : [];
    const keyframes = [...holdFrame, ...glowKeyframes(layer)];
    return {
      donorEffect,
      keepParticles,
      textures: swap ? [swap] : [],
      tune: {
        ...colourTune(layer, bloodRuleColour),
        ...(partColours.length ? { partColours } : {}),
        alphaScale: layer.opacity,
        zoomScale: round3(power(1.7, layer.amount)),
        spawnScale: round3(power(2, layer.amount) * countOf(layer)),
        ...aimOf(layer),
        ...(keyframes.length ? { keyframes } : {}),
        scales: motionScales(layer),
      },
    };
  }
  if (layer.kind === "template") {
    const item = findImpactTemplate(layer.template);
    const { keepParticles, partColours } = partsTune(zoneId, layer, unit, rules);
    const keyframes = glowKeyframes(layer);
    return {
      donorEffect: item.rule,
      ...(item.file ? { donorFile: item.file } : {}),
      keepParticles,
      textures: [],
      tune: {
        ...(layer.tinted && item.tint ? colourTune(layer, unit) : {}),
        ...(partColours.length ? { partColours } : {}),
        alphaScale: round3(layer.opacity * item.alpha),
        zoomScale: round3(item.scale * power(1.8, layer.amount)),
        ...(countOf(layer) !== 1 ? { spawnScale: round3(countOf(layer)) } : {}),
        ...(item.openAir ? { openAir: true } : {}),
        maxDuration: item.maxDuration,
        cullFade: IMPACT_CULL.fade,
        cullDist: IMPACT_CULL.cull,
        ...aimOf(layer),
        ...(keyframes.length ? { keyframes } : {}),
        scales: [
          ...motionScales(layer),
          ...(item.size !== 1
            ? [{ prop: "ptxEmitterRule:m_sizeScalarKFP", factor: item.size }]
            : []),
        ],
      },
    };
  }
  if (layer.kind === "custom") {
    const half = customPictureSize(layer.amount) / 2;
    const alpha = layer.opacity;
    const mode = layer.tinted ? layer.colourMode || "one" : "one";
    const tint = layer.tinted ? unit(layer.colour) : [1, 1, 1];
    const tint2 =
      layer.tinted && mode === "duo"
        ? unit(layer.colour2 || DEFAULT_SECOND_COLOUR)
        : tint;
    /* Цвет — белый (картинка как есть), оттенок, два оттенка или радуга;
       гаснет в последней четверти жизни. */
    const colourFrames = (colour) => [
      [0, ...colour, alpha],
      [0.72, ...colour, alpha],
      [1, ...colour, 0],
    ];
    const colourKeyframes =
      mode === "rainbow"
        ? [
            {
              scope: "particle",
              prop: "ptxu_Colour:m_rgbaMinKFP",
              values: rainbowKeyframes(alpha, 0),
            },
            {
              scope: "particle",
              prop: "ptxu_Colour:m_rgbaMaxKFP",
              values: rainbowKeyframes(alpha, 0.5),
            },
          ]
        : [
            {
              scope: "particle",
              prop: "ptxu_Colour:m_rgbaMinKFP",
              values: colourFrames(tint),
            },
            {
              scope: "particle",
              prop: "ptxu_Colour:m_rgbaMaxKFP",
              values: colourFrames(tint2),
            },
          ];
    /*
     * Донор: неподвижная картинка — всплеск дроби, крутящаяся — дуги треска
     * (`customDonor`). Разлёт — ширина пятачка, где картинки рождаются
     * (единица — прежние 10 см); длительность — срок жизни частицы.
     */
    const donor = customDonor(layer);
    const spins = donor === CUSTOM_SPIN_DONOR;
    const reach = round3(0.1 * (layer.motion?.spread ?? 1));
    const [lifeMin, lifeMax] = customLife(layer.duration, donor);
    return {
      donorEffect: donor.effect,
      keepParticles: [donor.particle],
      textures: [
        {
          texture,
          particles: [donor.particle],
          frameMin: 0,
          frameMax: 0,
        },
      ],
      tune: {
        oneShot: true,
        cullFade: IMPACT_CULL.fade,
        cullDist: IMPACT_CULL.cull,
        /*
         * Масштаб правила — 100 %. У донора (брызги дроби по воде) он
         * 8–9 %: игра умножает на него всё правило, и значок, заданный
         * в 22 см, выходил в игре двухсантиметровой точкой — «картинки не
         * работают» (владелец, 23.09.2026). Размер значка задан кадрами
         * частицы в метрах, и масштаб правила обязан их не трогать.
         */
        effectZoom: 100,
        keyframes: [
          /* Донор — кольцо всплесков дроби по воде: частицы у него рождаются
             на окружности больше метра. Значок обязан родиться у самой раны —
             область рождения сжимается до пятачка в десяток сантиметров. У дуг
             область — шар, сдвинутый на 30 см: он встаёт к самой ране. */
          ...(spins
            ? [
                {
                  scope: "emitter",
                  prop: "ptxCreationDomain:m_positionKFP",
                  values: [[0, 0, 0, 0, 0]],
                },
                {
                  scope: "emitter",
                  prop: "ptxCreationDomain:m_sizeOuterKFP",
                  values: [[0, reach, reach, reach, 0]],
                },
              ]
            : [
                {
                  scope: "emitter",
                  prop: "ptxCreationDomain:m_sizeOuterKFP",
                  values: [[0, reach, 0, reach, 0]],
                },
              ]),
          {
            scope: "emitter",
            prop: "ptxCreationDomain:m_sizeInnerKFP",
            values: [[0, 0, 0, 0, 0]],
          },
          /* Сколько картинок вылетает разом. */
          {
            scope: "emitter",
            prop: "ptxEmitterRule:m_spawnRateOverTimeKFP",
            values: [[0, layer.count, layer.count, 0, 0]],
          },
          /* Живёт столько, сколько задано (по умолчанию — меньше секунды:
             значок, а не вывеска). */
          {
            scope: "emitter",
            prop: "ptxEmitterRule:m_particleLifeKFP",
            values: [[0, lifeMin, lifeMax, 0, 0]],
          },
          /* Размер задан кадрами самой частицы в метрах, без множителя. */
          {
            scope: "emitter",
            prop: "ptxEmitterRule:m_sizeScalarKFP",
            values: [[0, 100, 100, 100, 100]],
          },
          /* Вылетает из точки и тут же тормозит (гашение у донора сильное):
             несколько картинок расходятся веером, одна остаётся у раны. У
             дуг гашения нет — крутящаяся картинка стоит там, где родилась,
             а веер ей даёт разлёт. */
          {
            scope: "emitter",
            prop: "ptxEmitterRule:m_speedScalarKFP",
            values: spins ? [[0, 0, 0, 0, 0]] : [[0, 0.9, 1.6, 0, 0]],
          },
          /* Появляется хлопком — от двух третей размера к полному — и держит. */
          {
            scope: "particle",
            prop: "ptxu_Size:m_whdMinKFP",
            values: [
              [0, round3(half * 0.62), round3(half * 0.62), 0, 0],
              [0.16, round3(half * 0.96), round3(half * 0.96), 0, 0],
              [1, half, half, 0, 0],
            ],
          },
          {
            scope: "particle",
            prop: "ptxu_Size:m_whdMaxKFP",
            values: [
              [0, round3(half * 0.7), round3(half * 0.7), 0, 0],
              [0.16, round3(half * 1.08), round3(half * 1.08), 0, 0],
              [1, round3(half * 1.12), round3(half * 1.12), 0, 0],
            ],
          },
          ...colourKeyframes,
          ...(spins ? customSpinKeyframes(layer) : []),
          ...glowKeyframes(layer),
        ],
        /* Скорость и срок жизни картинок — множителями поверх заданных выше
           кадров; число и разлёт картинок заданы явно выше. */
        scales: motionScales(layer, ["spread"]),
      },
    };
  }
  return null;
}

/*
 * Крутящаяся картинка на дугах треска: то, что у донора своё, перебивается,
 * а вращение берётся из настроек слоя.
 *   • вес матрицы — единица всю жизнь: картинка держится за кость, как
 *     неподвижная (у дуг он гаснет к пятой части жизни);
 *   • свечение — ноль (у дуг 16), если «Свечение» не включено: тогда его
 *     кадры кладёт `glowKeyframes` следом;
 *   • лист не листается (у дуг 4–6 кадров в секунду) — кадр у картинки один;
 *   • наклон — начальный угол ±tilt, вращение — скорость, °/с (дуги копят
 *     угол: `AccumulateAngle`). Скорость пишется во времени частицы: оно
 *     бежит в 3,3 раза быстрее часов, и 360°/с игры — это 109°/с дуг.
 */
function customSpinKeyframes(layer) {
  const tilt = round3(Number(layer.tilt) || 0);
  const spin = round3((Number(layer.spin) || 0) / CUSTOM_SPIN_DONOR.playback);
  return [
    {
      scope: "particle",
      prop: "ptxu_MatrixWeight:m_mtxWeightKFP",
      values: [[0, 1, 1, 0, 0]],
    },
    ...(layer.glow
      ? []
      : [{ scope: "particle", prop: GLOW_PROP, values: [[0, 0, 0, 0, 0]] }]),
    {
      scope: "particle",
      prop: "ptxu_AnimateTexture:m_animRateKFP",
      values: [[0, 0, 0, 0, 0]],
    },
    {
      scope: "particle",
      prop: "ptxu_Rotation:m_initialAngleMinKFP",
      values: [[0, 0 - tilt || 0, 0, 0, 0]],
    },
    {
      scope: "particle",
      prop: "ptxu_Rotation:m_initialAngleMaxKFP",
      values: [[0, tilt, 0, 0, 0]],
    },
    {
      scope: "particle",
      prop: "ptxu_Rotation:m_angleMinKFP",
      values: [[0, spin, 0, 0, 0]],
    },
    {
      scope: "particle",
      prop: "ptxu_Rotation:m_angleMaxKFP",
      values: [[0, spin, 0, 0, 0]],
    },
  ];
}

/*
 * Дальность зоны → настройка составного правила. Единица и штатные 150 м не
 * пишутся: клон с дальностью «как в игре» не несёт лишнего поля.
 */
export function impactLodRecipe(distance) {
  const lod = {};
  const near = distance?.near ?? 1;
  const far = distance?.far ?? 1;
  const reach = distance?.reach ?? DEFAULT_IMPACT_DISTANCE.reach;
  if (near !== 1) lod.near = round3(near);
  if (far !== 1) lod.far = round3(far);
  if (reach !== DEFAULT_IMPACT_DISTANCE.reach) lod.reach = Math.round(reach);
  return Object.keys(lod).length ? lod : null;
}

/**
 * Рецепт составного клона одной стороны зоны: имя правила, слои и дальность.
 * `textures` — текстуры слоёв по их номеру в стопке: картинка или свой лист
 * брызг. `null`, если с этой стороны слоёв нет.
 */
export function impactCloneRecipe(
  zoneId,
  settings,
  { rule, textures = {}, placement = "front", rules = null },
) {
  const layers = placementLayers(settings, placement).map(({ layer, index }) =>
    impactLayerRecipe(zoneId, layer, {
      texture: textures[index] || null,
      rules,
    }),
  );
  if (!layers.length) return null;
  const lod = impactLodRecipe(settings.distance);
  return {
    effect: rule,
    layers,
    ...(lod ? { lod } : {}),
  };
}
