/*
 * «Дым из-под колёс» — договор редактора мастерской (задача 1 ТЗ владельца
 * 11.10.2026, вечер: «чтобы люди могли настраивать его как угодно: цвет,
 * прозрачность, вместо дыма звёзды с искрами, размер…»). Одно описание на
 * окно (кадр с машиной), установщик (`apps/desktop/src/wheel-smoke.js`) и
 * пересборку из библиотеки.
 *
 * КАК ЭТО В ИГРЕ. Дым из-под колёс — правила частиц ядра `core.ypt`, а когда
 * какое играть, говорит таблица `common/data/effects/wheelfx.dat` в
 * update.rpf: строка на материал дороги, в ней столбцы «трение» (занос и
 * дрифт: машина, мотоцикл, танк) и «прожиг» (пробуксовка на месте: те же
 * трое). На твёрдом — асфальте, бетоне, камне — это `wheel_fric_hard`,
 * `wheel_fric_hard_Bike` и `wheel_burnout`. Искры обода у пробитой шины —
 * `rim_fric_hard`, горящее колесо — `fire_wheel`.
 *
 * ЧТО ДЕЛАЕТ ASTRAL. Штатных правил не трогает ни байта (правило всей
 * студии эффектов): рядом в ядре встают клоны `astral_wheel_*` — двоичные
 * копии штатных правил игрока со своим цветом, прозрачностью, размером,
 * густотой и сроком жизни (`YptEffectClones` помощника; в окне — тот же
 * `buildEffectClone` из `@modovik/ptfx-runtime`), а в `wheelfx.dat` имена
 * штатных правил в столбцах эффектов меняются на имена клонов. «Как в игре»
 * — клонов нет, в таблице снова штатные имена.
 *
 * Виды, кроме дыма, — составные клоны: «Звёзды» и «Сердечки» — частица дыма
 * игры (её полёт, вращение, ветер) со своим листом-значком, который рисует
 * приложение (`wheelGlyphSheet`, текстур Rockstar в поставке нет), и по
 * желанию — искры обода игры; «Искры» — искры обода; «Огонь» — пламя
 * горящего колеса. «Без дыма» — в столбцах «-», как у оптимизации.
 *
 * ОГОНЬ ВЫХЛОПА (ТЗ 17.10.2026, второй заход, задача 8: «менять цвет огня из
 * выхлопа»). Задний огонь и хлопки — тоже правила ядра, а какое играть,
 * говорит не код, а данные: `x64/data/effects/vfxvehicleinfo.ymt` в
 * update.rpf, по записи на класс машины, в ней хешем имени — `backfirePtFxName`
 * (задний огонь: `veh_backfire`, `veh_backfire_narrow`,
 * `veh_sm_car_small_backfire`) и `misfirePtFxName` (хлопки:
 * `veh_exhaust_misfire`). Тот же приём, что у дыма: клоны `astral_wheel_*`
 * (пламя и свечение — своим цветом, дымка и марево — как в игре) и замена
 * хеша в этих полях (`vehicleVfx` в `compileWheelSmoke`; запись файла —
 * `apps/desktop/src/vehicle-vfx.js`). «Как в игре» — хеши снова штатные.
 *
 * ВОЗДУШНЫЙ ПАКЕТ (там же: «когда едешь за какой-то машиной: сделать его более
 * выраженным, цвет, прозрачность…»). Белые полосы воздуха, когда едешь в
 * струе чужой машины, — правило `veh_slipstream`. Его имени нет ни в одном
 * файле данных: игра зовёт правило по имени из своего кода, и клону под
 * своим именем она не дала бы ни кадра. Поэтому клон встаёт ПОД ШТАТНЫМ
 * ИМЕНЕМ, а штатное правило уходит под скрытое `astral_wheel_stock_veh_slipstream`
 * и возвращается снятием семейства (`YptEffectClones.SwapIn` помощника) —
 * «как в игре» это обратное переименование, байты оригинала целы.
 *
 * Работа — плоский объект: её поля и есть данные кода работы. Схема 2
 * добавила огонь выхлопа, схема 3 — воздушный пакет; работы прежних схем
 * открываются как были (новых полей в них нет, и берутся значения «как в
 * игре»).
 */

export const WHEEL_SMOKE_PROJECT_SCHEMA = 3;
/** Приставка всего, что редактор кладёт в ядро: клоны и листы значков. */
export const WHEEL_SMOKE_PREFIX = "astral_wheel_";
/** Таблица колёс в update.rpf. */
export const WHEEL_FX_ENTRY = "common/data/effects/wheelfx.dat";
/** Эффекты машин по классам в update.rpf: имена выхлопа и хлопков. */
export const VEHICLE_VFX_ENTRY = "x64/data/effects/vfxvehicleinfo.ymt";
/** Поля класса машины, в которых стоят имена огня выхлопа (хеш имени). */
export const VEHICLE_VFX_FIELDS = Object.freeze(["backfirePtFxName", "misfirePtFxName"]);
/** Лист дыма, который рисует частица дыма игры: его подменяет лист значка. */
export const WHEEL_SMOKE_SHEET = "ptfx_smoke_wispy_anim";

/*
 * Где играет дым. `stock` — правило игры, `clone` — своё, `columns` —
 * столбцы строки wheelfx.dat (счёт с нуля, имя материала — 0): трение —
 * 13 машина, 14 мотоцикл, 15 танк; прожиг — 26, 27, 28. Танки не трогаются.
 * `particle` — частица дыма донора: на ней летят значки.
 */
export const WHEEL_SMOKE_TARGETS = Object.freeze([
  Object.freeze({
    id: "burnout",
    label: "Пробуксовка",
    note: "газ в пол на месте — дым из-под ведущих колёс",
    stock: "wheel_burnout",
    clone: "astral_wheel_burnout",
    columns: Object.freeze([26]),
    /* Облако, которое отлетает за машину на 4–5 м (владелец, 11.10.2026,
       вечер: «чтобы дым отлетал назад автомобиля»). Не столб
       (`wheel_burnout_plume`): у него размер частицы дорисован эволюциями
       `temp` и `speed` (до 9 м), и значок у горячей шины вырастал в
       двухметровую звезду — свои кадры размера эволюции перекрывают. И не
       кольцо у шины (`wheel_burnout_disc`): оно почти не летит, звёзды
       толпились у колеса. У облака эволюций размера частицы нет. */
    particle: "wheel_burnout_lingering",
    /* Облаков у шины рождается мало: значков — не меньше, чем облаков. */
    glyphSpawn: 2.5,
    /* Дымка под значками, искрами и огнём — столб, облако и низкий туман:
       кольцо и лужа у шины ей ни к чему, а пять эмиттеров дыма, значок и
       две искры — восемь, больше семи на правило игра не играет. */
    veil: Object.freeze(["wheel_burnout_plume", "wheel_burnout_lingering", "wheel_burnout_low_mist"]),
  }),
  Object.freeze({
    id: "drift",
    label: "Дрифт и занос",
    note: "колёса скользят боком по асфальту, бетону, камню",
    stock: "wheel_fric_hard",
    clone: "astral_wheel_fric",
    columns: Object.freeze([13]),
    particle: "wheel_fric_tyre",
  }),
  Object.freeze({
    id: "bike",
    label: "Мотоциклы",
    note: "занос и пробуксовка мотоцикла",
    stock: "wheel_fric_hard_Bike",
    clone: "astral_wheel_fric_bike",
    columns: Object.freeze([14]),
    particle: "wheel_fric_tyre",
    /* У мотоцикла и прожиг: столбец 27 — правило пробуксовки. */
    burnoutColumns: Object.freeze([27]),
  }),
]);

/** Доноры, которые читает окно для кадра и установщик для клонов. */
export const WHEEL_SMOKE_SPARKS = Object.freeze({ donor: "rim_fric_hard", particles: Object.freeze(["rim_fric_sparks", "rim_fric_sparkoff"]) });
export const WHEEL_SMOKE_FIRE = Object.freeze({ donor: "fire_wheel" });

/*
 * Огонь выхлопа: что в игре играет у выхлопной трубы. `group` — «Задний
 * огонь» или «Хлопки» (их включают порознь), `stock` — штатное правило,
 * `clone` — своё. `flame` — частицы донора, которые красятся (пламя и
 * свечение, у хлопков — искры); `veil` — остальные (дым и марево): они идут
 * вторым слоем клона без правки, как в игре. Донор — один и тот же, поэтому
 * время и эволюции (`damage`, `banger`) у слоёв общие.
 */
export const WHEEL_SMOKE_EXHAUST_GROUPS = Object.freeze([
  Object.freeze({ id: "backfire", field: "exhaustBackfire", label: "Задний огонь", note: "вспышка из трубы при сбросе газа и переключении передач" }),
  Object.freeze({ id: "misfire", field: "exhaustMisfire", label: "Хлопки", note: "искры и дымок из глушителя" }),
]);
export const WHEEL_SMOKE_EXHAUST = Object.freeze([
  Object.freeze({
    id: "backfire",
    group: "backfire",
    stock: "veh_backfire",
    clone: "astral_wheel_backfire",
    flame: Object.freeze(["veh_exhaust_backfire", "veh_backfire_glow"]),
    veil: Object.freeze(["veh_exhaust_backfire_smoke2", "veh_exhaust_haze"]),
  }),
  Object.freeze({
    id: "backfire-narrow",
    group: "backfire",
    stock: "veh_backfire_narrow",
    clone: "astral_wheel_backfire_narrow",
    flame: Object.freeze(["veh_backfire_narrow", "veh_backfire_glow"]),
    veil: Object.freeze(["veh_backfire_narrow_smoke2", "veh_exhaust_haze"]),
  }),
  Object.freeze({
    id: "backfire-small",
    group: "backfire",
    stock: "veh_sm_car_small_backfire",
    clone: "astral_wheel_backfire_small",
    flame: Object.freeze(["veh_sm_car_small_backfire", "veh_sm_car_small_backfire_glow"]),
    veil: Object.freeze(["veh_sm_car_small_backfire_smoke2", "veh_sm_car_small_backfire_haze"]),
  }),
  Object.freeze({
    id: "misfire",
    group: "misfire",
    stock: "veh_exhaust_misfire",
    clone: "astral_wheel_misfire",
    flame: Object.freeze(["veh_exhaust_sparks_cars"]),
    veil: Object.freeze(["veh_exhaust_misfire"]),
  }),
]);

/**
 * Воздушный пакет: штатное правило, клон (под этим именем оно играет в кадре
 * окна) и скрытое имя, под которым штатное лежит в ядре игрока, пока клон
 * стоит под его именем. Приставка `astral_wheel_` у клона и скрытого имени —
 * общая со всем семейством, и снятие семейства возвращает штатное правило.
 */
export const WHEEL_SMOKE_SLIPSTREAM = Object.freeze({
  stock: "veh_slipstream",
  clone: "astral_wheel_slipstream",
  hidden: "astral_wheel_stock_veh_slipstream",
  /* Возможности помощника, без которых клон под штатным именем не встанет. */
  features: Object.freeze(["effect-clone-in-place"]),
});

export const WHEEL_SMOKE_DONORS = Object.freeze([
  ...new Set([
    ...WHEEL_SMOKE_TARGETS.map((target) => target.stock),
    WHEEL_SMOKE_SPARKS.donor,
    WHEEL_SMOKE_FIRE.donor,
    ...WHEEL_SMOKE_EXHAUST.map((effect) => effect.stock),
    WHEEL_SMOKE_SLIPSTREAM.stock,
  ]),
]);

/*
 * Листы значков: рисует приложение (`wheelGlyphSheet`), белые — цвет даёт
 * правило. Один кадр 128×128: сетка 1×1 уходит в ptxclipregions.dat.
 */
export const WHEEL_GLYPH_EDGE = 128;
export const WHEEL_GLYPHS = Object.freeze({
  star: Object.freeze({ texture: "astral_wheel_star", label: "звезда" }),
  heart: Object.freeze({ texture: "astral_wheel_heart", label: "сердце" }),
});

export const WHEEL_SMOKE_LOOKS = Object.freeze([
  Object.freeze({ id: "smoke", label: "Дым", note: "дым игры своим цветом, прозрачностью и размером" }),
  Object.freeze({ id: "stars", label: "Звёзды", note: "из-под колёс вылетают светящиеся звёзды", glyph: "star" }),
  Object.freeze({ id: "hearts", label: "Сердечки", note: "вместо дыма — светящиеся сердечки", glyph: "heart" }),
  Object.freeze({ id: "sparks", label: "Искры", note: "сноп искр, как у обода без шины" }),
  Object.freeze({ id: "fire", label: "Огонь", note: "пламя горящего колеса" }),
  Object.freeze({ id: "none", label: "Без дыма", note: "колёса не дымят вовсе" }),
]);

export const WHEEL_SMOKE_COLOUR_MODES = Object.freeze([
  Object.freeze({ id: "game", label: "Как в игре", note: "цвет игры: серый дым, оранжевые искры" }),
  Object.freeze({ id: "one", label: "Свой цвет", note: "один цвет" }),
  Object.freeze({ id: "two", label: "Два цвета", note: "каждой частице — случайный оттенок между двумя" }),
  Object.freeze({ id: "rainbow", label: "Радуга", note: "цвет бежит по кругу за жизнь частицы" }),
]);

/** Пределы ползунков: у каждого — поле числом с теми же пределами. */
export const WHEEL_SMOKE_LIMITS = Object.freeze({
  /* «Заметность», как у воздушного пакета: «Плотность» рядом с «Густотой» читалась одним и тем же (критик 30.10.2026). */
  opacity: Object.freeze({ min: 10, max: 200, step: 5, unit: "%", label: "Заметность" }),
  size: Object.freeze({ min: 25, max: 300, step: 5, unit: "%", label: "Размер" }),
  density: Object.freeze({ min: 10, max: 300, step: 5, unit: "%", label: "Густота" }),
  length: Object.freeze({ min: 25, max: 300, step: 5, unit: "%", label: "Сколько висит" }),
  /* Огонь выхлопа. */
  exhaustOpacity: Object.freeze({ min: 10, max: 300, step: 5, unit: "%", label: "Яркость" }),
  exhaustSize: Object.freeze({ min: 25, max: 300, step: 5, unit: "%", label: "Размер" }),
  exhaustLength: Object.freeze({ min: 25, max: 300, step: 5, unit: "%", label: "Сколько горит" }),
  /* Воздушный пакет. «Заметность» 200 % — полная непрозрачность полос. */
  slipOpacity: Object.freeze({ min: 10, max: 200, step: 5, unit: "%", label: "Заметность" }),
  slipGlow: Object.freeze({ min: 25, max: 400, step: 5, unit: "%", label: "Свечение" }),
  slipSize: Object.freeze({ min: 25, max: 300, step: 5, unit: "%", label: "Толщина" }),
  slipLength: Object.freeze({ min: 25, max: 300, step: 5, unit: "%", label: "Длина" }),
});

/*
 * По умолчанию — дым игры как есть. Цвет «Свой» по умолчанию белый, второй
 * цвет — красный: так «Два цвета» сразу видно.
 */
export const WHEEL_SMOKE_DEFAULTS = Object.freeze({
  look: "smoke",
  colourMode: "game",
  colour: "#ffffff",
  colour2: "#ff3b3b",
  opacity: 100,
  size: 100,
  density: 100,
  length: 100,
  /* У значков, искр и огня: оставить под ними дым игры. */
  smoke: false,
  /* У звёзд и сердечек: искры обода вместе с ними. */
  sparks: true,
  burnout: true,
  drift: true,
  bike: true,
  /*
   * Огонь выхлопа: по умолчанию — как в игре (оранжевый, 100 %). Цвет
   * «Свой» по умолчанию синий — самая частая просьба, второй — фиолетовый.
   */
  exhaustColourMode: "game",
  exhaustColour: "#2f7bff",
  exhaustColour2: "#9b5cff",
  exhaustOpacity: 100,
  exhaustSize: 100,
  exhaustLength: 100,
  exhaustBackfire: true,
  exhaustMisfire: true,
  /*
   * Воздушный пакет: по умолчанию — как в игре (белые полосы). Цвет «Свой» по
   * умолчанию голубой, второй — розовый.
   */
  slipColourMode: "game",
  slipColour: "#2fd4ff",
  slipColour2: "#ff4fd8",
  slipOpacity: 100,
  slipGlow: 100,
  slipSize: 100,
  slipLength: 100,
});

const LOOK_IDS = new Set(WHEEL_SMOKE_LOOKS.map((item) => item.id));
const MODE_IDS = new Set(WHEEL_SMOKE_COLOUR_MODES.map((item) => item.id));
const HEX = /^#[0-9a-f]{6}$/i;
const NAME_LIMIT = 80;

const pick = (value, allowed, fallback) => (allowed.has(value) ? value : fallback);
const colour = (value, fallback) => (HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback);
const bounded = (value, { min, max, step }, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number / step) * step));
};
const flag = (value, fallback) => (typeof value === "boolean" ? value : fallback);
const round = (value, digits = 3) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

export const wheelSmokeLook = (id) => WHEEL_SMOKE_LOOKS.find((item) => item.id === id) || WHEEL_SMOKE_LOOKS[0];

/** Работа в границах договора; чужие поля отбрасываются. */
export function normalizeWheelSmokeProject(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const base = WHEEL_SMOKE_DEFAULTS;
  const look = pick(source.look, LOOK_IDS, base.look);
  /* У значков цвета игры нет: их лист рисует приложение, и «как в игре»
     сделал бы звёзды цветом серого дыма. */
  let colourMode = pick(source.colourMode, MODE_IDS, base.colourMode);
  if (colourMode === "game" && wheelSmokeLook(look).glyph) colourMode = "one";
  return {
    schema: WHEEL_SMOKE_PROJECT_SCHEMA,
    name: String(source.name || "").trim().slice(0, NAME_LIMIT),
    look,
    colourMode,
    colour: colour(source.colour, wheelSmokeLook(look).glyph && !source.colour ? "#ffd34d" : base.colour),
    colour2: colour(source.colour2, base.colour2),
    opacity: bounded(source.opacity, WHEEL_SMOKE_LIMITS.opacity, base.opacity),
    size: bounded(source.size, WHEEL_SMOKE_LIMITS.size, base.size),
    density: bounded(source.density, WHEEL_SMOKE_LIMITS.density, base.density),
    length: bounded(source.length, WHEEL_SMOKE_LIMITS.length, base.length),
    smoke: flag(source.smoke, base.smoke),
    sparks: flag(source.sparks, base.sparks),
    burnout: flag(source.burnout, base.burnout),
    drift: flag(source.drift, base.drift),
    bike: flag(source.bike, base.bike),
    exhaustColourMode: pick(source.exhaustColourMode, MODE_IDS, base.exhaustColourMode),
    exhaustColour: colour(source.exhaustColour, base.exhaustColour),
    exhaustColour2: colour(source.exhaustColour2, base.exhaustColour2),
    exhaustOpacity: bounded(source.exhaustOpacity, WHEEL_SMOKE_LIMITS.exhaustOpacity, base.exhaustOpacity),
    exhaustSize: bounded(source.exhaustSize, WHEEL_SMOKE_LIMITS.exhaustSize, base.exhaustSize),
    exhaustLength: bounded(source.exhaustLength, WHEEL_SMOKE_LIMITS.exhaustLength, base.exhaustLength),
    exhaustBackfire: flag(source.exhaustBackfire, base.exhaustBackfire),
    exhaustMisfire: flag(source.exhaustMisfire, base.exhaustMisfire),
    slipColourMode: pick(source.slipColourMode, MODE_IDS, base.slipColourMode),
    slipColour: colour(source.slipColour, base.slipColour),
    slipColour2: colour(source.slipColour2, base.slipColour2),
    slipOpacity: bounded(source.slipOpacity, WHEEL_SMOKE_LIMITS.slipOpacity, base.slipOpacity),
    slipGlow: bounded(source.slipGlow, WHEEL_SMOKE_LIMITS.slipGlow, base.slipGlow),
    slipSize: bounded(source.slipSize, WHEEL_SMOKE_LIMITS.slipSize, base.slipSize),
    slipLength: bounded(source.slipLength, WHEEL_SMOKE_LIMITS.slipLength, base.slipLength),
  };
}

export const createWheelSmokeProject = (input = {}) => normalizeWheelSmokeProject(input);
export const serializeWheelSmokeProject = (project) => JSON.stringify(normalizeWheelSmokeProject(project));

export function parseWheelSmokeProject(value) {
  try {
    return normalizeWheelSmokeProject(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return createWheelSmokeProject();
  }
}

/** Где дым работы встаёт: включённые цели. */
export const wheelSmokeTargets = (input) => {
  const project = normalizeWheelSmokeProject(input);
  return WHEEL_SMOKE_TARGETS.filter((target) => project[target.id]);
};

/**
 * Дым как в игре: вид «Дым» цвета игры, все ползунки — 100 %. Где он стоит,
 * тогда неважно: ставить нечего, «Применить» только вернёт игре её дым.
 */
export function wheelSmokeSmokeIsStock(input) {
  const project = normalizeWheelSmokeProject(input);
  return (
    project.look === "smoke" &&
    project.colourMode === "game" &&
    project.opacity === 100 &&
    project.size === 100 &&
    project.density === 100 &&
    project.length === 100
  );
}

/** Огонь выхлопа как в игре: цвет игры, все ползунки — 100 %. */
export function wheelSmokeExhaustIsStock(input) {
  const project = normalizeWheelSmokeProject(input);
  return (
    project.exhaustColourMode === "game" &&
    project.exhaustOpacity === 100 &&
    project.exhaustSize === 100 &&
    project.exhaustLength === 100
  );
}

/** Воздушный пакет как в игре: белые полосы игры, все ползунки — 100 %. */
export function wheelSmokeSlipstreamIsStock(input) {
  const project = normalizeWheelSmokeProject(input);
  return (
    project.slipColourMode === "game" &&
    project.slipOpacity === 100 &&
    project.slipGlow === 100 &&
    project.slipSize === 100 &&
    project.slipLength === 100
  );
}

/** Вся работа как в игре: ставить нечего, «Применить» только вернёт игре её файлы. */
export function wheelSmokeIsStock(input) {
  const project = normalizeWheelSmokeProject(input);
  return wheelSmokeSmokeIsStock(project) && wheelSmokeExhaustIsStock(project) && wheelSmokeSlipstreamIsStock(project);
}

/** Отпечаток для «Применить»: только то, что уходит в игру (без имени). */
export function wheelSmokeSignature(input) {
  const { name: _name, ...rest } = normalizeWheelSmokeProject(input);
  return JSON.stringify(wheelSmokeIsStock(rest) ? { stock: true } : rest);
}

/** Работа словами — для строки состояния и записи установки. */
export function describeWheelSmoke(input) {
  const project = normalizeWheelSmokeProject(input);
  if (wheelSmokeIsStock(project)) return "как в игре";
  const parts = [];
  if (!wheelSmokeSmokeIsStock(project)) {
    const look = wheelSmokeLook(project.look);
    parts.push(look.label.toLowerCase());
    if (look.glyph && project.sparks) parts[0] = `${parts[0]} с искрами`;
    if (project.look !== "none") {
      if (project.colourMode === "two") parts.push("два цвета");
      else if (project.colourMode === "rainbow") parts.push("радуга");
      else if (project.colourMode === "one") parts.push(project.colour);
      if (project.size !== 100) parts.push(`размер ${project.size} %`);
    }
    const where = wheelSmokeTargets(project);
    if (!where.length) parts.push("нигде");
    else if (where.length < WHEEL_SMOKE_TARGETS.length) parts.push(where.map((item) => item.label.toLowerCase()).join(", "));
  }
  if (!wheelSmokeExhaustIsStock(project)) {
    parts.push("огонь выхлопа");
    if (project.exhaustColourMode === "two") parts.push("два цвета");
    else if (project.exhaustColourMode === "rainbow") parts.push("радуга");
    else if (project.exhaustColourMode === "one") parts.push(project.exhaustColour);
    if (project.exhaustSize !== 100) parts.push(`размер ${project.exhaustSize} %`);
  }
  if (!wheelSmokeSlipstreamIsStock(project)) {
    parts.push("воздушный пакет");
    if (project.slipColourMode === "two") parts.push("два цвета");
    else if (project.slipColourMode === "rainbow") parts.push("радуга");
    else if (project.slipColourMode === "one") parts.push(project.slipColour);
    if (project.slipSize !== 100) parts.push(`размер ${project.slipSize} %`);
  }
  return parts.join(" · ");
}

/* --------------------------------- клоны --------------------------------- */

const rgbFloat = (hex) => [1, 3, 5].map((at) => round(parseInt(hex.slice(at, at + 2), 16) / 255, 4));
/* Цвет кадров клона: помощник красит «цвет × яркость кадра донора» и режет
   по единице, поэтому у тусклых доноров цвет поднимается множителем. */
const lifted = (hex, lift) => rgbFloat(hex).map((value) => round(Math.min(4, value * lift), 4));

/* Цвет слоя по режиму работы. `lift` — во сколько поднять цвет у тусклого
   донора; «как в игре» — без цвета. */
function colourTune(project, lift = 1) {
  if (project.colourMode === "game") return {};
  if (project.colourMode === "two")
    return { colourMode: "duo", colour: lifted(project.colour, lift), colour2: lifted(project.colour2, lift) };
  if (project.colourMode === "rainbow") return { colourMode: "rainbow", colour: lifted(project.colour, lift) };
  return { colour: lifted(project.colour, lift) };
}

/* Общие ползунки слоя: густота, размер, срок жизни. `spawn` — своя густота
   слоя при 100 %. */
function shapeTune(project, { spawn = 1, size = 1 } = {}) {
  const tune = {};
  const density = round(Math.min(8, Math.max(0.1, spawn * (project.density / 100))));
  if (density !== 1) tune.spawnScale = density;
  const scales = [];
  const sizeFactor = round(Math.min(8, size * (project.size / 100)));
  if (sizeFactor !== 1) scales.push({ prop: "ptxEmitterRule:m_sizeScalarKFP", factor: sizeFactor });
  if (project.length !== 100) scales.push({ prop: "ptxEmitterRule:m_particleLifeKFP", factor: round(project.length / 100) });
  if (scales.length) tune.scales = scales;
  return tune;
}

const alphaTune = (scale) => {
  const value = round(Math.min(4, Math.max(0.05, scale)));
  return value === 1 ? {} : { alphaScale: value };
};

/* Дым игры этой цели со своим цветом и ползунками. */
function smokeLayer(project, target, { veil = false } = {}) {
  return {
    donorEffect: target.stock,
    ...(veil && target.veil ? { keepParticles: [...target.veil] } : {}),
    tune: {
      ...colourTune(project, 1.35),
      ...alphaTune((project.opacity / 100) * (veil ? 0.45 : 1)),
      ...shapeTune(project),
    },
  };
}

/*
 * Значки на частице дыма: её полёт, вращение и ветер остаются, лист — свой,
 * размер — свой (дым растёт до метров, значок — ладонь), свечение — своё:
 * частица дыма освещается сценой, и ночью звезда без свечения была бы серой.
 */
const GLYPH_SIZE = Object.freeze([0.24, 0.34]);
const GLYPH_EMISSIVE = 1.6;
/* Частица дыма у донора почти прозрачна (до 0,35): значку — до непрозрачной. */
const GLYPH_ALPHA = 2.8;
/* Значков меньше, чем клубов дыма: иначе сплошная каша. */
const GLYPH_SPAWN = 0.4;

function glyphLayer(project, target, glyph) {
  const particle = target.particle;
  return {
    donorEffect: target.stock,
    keepParticles: [particle],
    textures: [
      {
        texture: glyph.texture,
        particles: [particle],
        donorTexture: WHEEL_SMOKE_SHEET,
        frameMin: 0,
        frameMax: 0,
        lastFrame: 0,
      },
    ],
    tune: {
      ...colourTune(project.colourMode === "game" ? { ...project, colourMode: "one" } : project, 1.45),
      ...alphaTune(GLYPH_ALPHA * (project.opacity / 100)),
      ...shapeTune(project, { spawn: target.glyphSpawn ?? GLYPH_SPAWN }),
      keyframes: [
        { scope: "particle", particle, prop: "ptxu_Size:m_whdMinKFP", values: [[0, GLYPH_SIZE[0], GLYPH_SIZE[0], 0, 0]] },
        { scope: "particle", particle, prop: "ptxu_Size:m_whdMaxKFP", values: [[0, GLYPH_SIZE[1], GLYPH_SIZE[1], 0, 0]] },
        { scope: "particle", particle, prop: "ptxu_Colour:m_emissiveIntensityKFP", values: [[0, GLYPH_EMISSIVE, GLYPH_EMISSIVE, 0, 0]] },
      ],
    },
  };
}

/* Искры обода игры: свои у них цвет и густота, размер — от работы. */
function sparksLayer(project, { companion = false } = {}) {
  return {
    donorEffect: WHEEL_SMOKE_SPARKS.donor,
    keepParticles: [...WHEEL_SMOKE_SPARKS.particles],
    tune: {
      ...colourTune(project),
      ...alphaTune(project.opacity / 100),
      ...shapeTune(project, { spawn: companion ? 0.6 : 1 }),
    },
  };
}

function fireLayer(project) {
  return {
    donorEffect: WHEEL_SMOKE_FIRE.donor,
    tune: { ...colourTune(project), ...alphaTune(project.opacity / 100), ...shapeTune(project) },
  };
}

/** Слои клона одной цели по виду работы (без «Без дыма» и «как в игре»). */
export function wheelSmokeLayers(input, target) {
  const project = normalizeWheelSmokeProject(input);
  const look = wheelSmokeLook(project.look);
  const layers = [];
  /*
   * Дым игры под значками, искрами или огнём — полупрозрачной дымкой, и
   * ПЕРВЫМ слоем. У правила не больше пяти эволюций, лишние снимаются с
   * конца списка, а список собирается по порядку слоёв: огонь первым
   * (`LOD, speed, timer`) вытеснял у дыма заноса `spin`, без которого
   * `wheel_fric_tyre` не рождается, — дым под огнём в игре пропадал. Дымом
   * первым вытесняется `timer` огня: колёсам игра его не передаёт.
   */
  if (look.id !== "smoke" && project.smoke) layers.push(smokeLayer(project, target, { veil: true }));
  if (look.glyph) {
    layers.push(glyphLayer(project, target, WHEEL_GLYPHS[look.glyph]));
    if (project.sparks) layers.push(sparksLayer(project, { companion: true }));
  } else if (look.id === "sparks") layers.push(sparksLayer(project));
  else if (look.id === "fire") layers.push(fireLayer(project));
  else layers.push(smokeLayer(project, target));
  return layers;
}

/* Поля огня выхлопа в виде, который читают `colourTune`, `alphaTune` и `shapeTune`. */
const exhaustPaint = (project) => ({
  colourMode: project.exhaustColourMode,
  colour: project.exhaustColour,
  colour2: project.exhaustColour2,
  opacity: project.exhaustOpacity,
  size: project.exhaustSize,
  length: project.exhaustLength,
  density: 100,
});

/* Свет пламени тусклее листа донора: цвет поднимается множителем. */
const FLAME_LIFT = 1.15;

/**
 * Слои клона одного правила огня выхлопа: дымка и марево — как в игре
 * (первым слоем: у правила не больше пяти эволюций, а у слоёв донора они
 * одни и те же — `damage`, `banger`), пламя и свечение — со своим цветом,
 * яркостью, размером и сроком горения.
 */
export function wheelSmokeExhaustLayers(input, effect) {
  const paint = exhaustPaint(normalizeWheelSmokeProject(input));
  return [
    { donorEffect: effect.stock, keepParticles: [...effect.veil] },
    {
      donorEffect: effect.stock,
      keepParticles: [...effect.flame],
      tune: { ...colourTune(paint, FLAME_LIFT), ...alphaTune(paint.opacity / 100), ...shapeTune(paint) },
    },
  ];
}

/* Поля воздушного пакета в виде, который читает `colourTune`. */
const slipstreamPaint = (project) => ({
  colourMode: project.slipColourMode,
  colour: project.slipColour,
  colour2: project.slipColour2,
});

/**
 * Слой клона воздушного пакета: цвет — кадрами цвета донора (белые, цвет
 * ложится как есть), «Заметность» — прозрачность кадров, «Свечение» — кадры
 * свечения шейдера ленты (у донора оно шестнадцатикратное и целиком живёт в
 * эволюции), «Толщина» — масштаб события, «Длина» — срок жизни частицы ленты:
 * лента тянется за едущей машиной, и чем дольше живёт частица, тем она длиннее
 * (точка цели эмиттера на длину не влияет: скорость частиц у правила нулевая).
 */
export function wheelSmokeSlipstreamLayers(input) {
  const project = normalizeWheelSmokeProject(input);
  const tune = { ...colourTune(slipstreamPaint(project)), ...alphaTune(project.slipOpacity / 100) };
  if (project.slipGlow !== 100) tune.emissiveScale = round(Math.min(8, Math.max(0.05, project.slipGlow / 100)));
  if (project.slipSize !== 100) tune.zoomScale = round(Math.min(8, Math.max(0.05, project.slipSize / 100)));
  if (project.slipLength !== 100)
    tune.scales = [{ prop: "ptxEmitterRule:m_particleLifeKFP", factor: round(Math.min(8, project.slipLength / 100)) }];
  return [{ donorEffect: WHEEL_SMOKE_SLIPSTREAM.stock, tune }];
}

/**
 * Что уезжает в игру:
 *
 *   • `clones` — заказы клонов ядра (`{ effect, layers }`, поля как у
 *     `YptEffectClones` помощника и `buildEffectClone` окна);
 *   • `cloneReset` — приставки, под которыми прежние клоны снимаются;
 *   • `textures` — листы значков: имя и вид (`wheelGlyphSheet`);
 *   • `clipSheets` — их сетки для ptxclipregions.dat;
 *   • `columns` — правка wheelfx.dat: `{ столбец: { stock, value } }` по
 *     целям (`patchWheelFx`);
 *   • `vehicleVfx` — правка vfxvehicleinfo.ymt: `effects` — по правилу огня
 *     выхлопа его штатное имя, имя клона и `value` — какое из них должно
 *     стоять в полях `fields` (клон — если правило включено, иначе штатное);
 *   • воздушный пакет — тоже клон в `clones`, но с `replaces`: он встаёт под
 *     штатным именем (`WHEEL_SMOKE_SLIPSTREAM`), а штатное прячется; нужные
 *     для этого возможности helper-а — `helperFeatures`.
 *
 * «Как в игре» — клонов и листов нет, столбцы и имена — штатные. `smokeStock`
 * и `exhaustStock` — какая часть работы как в игре.
 */
export function compileWheelSmoke(input) {
  const project = normalizeWheelSmokeProject(input);
  const smokeStock = wheelSmokeSmokeIsStock(project);
  const exhaustStock = wheelSmokeExhaustIsStock(project);
  const slipstreamStock = wheelSmokeSlipstreamIsStock(project);
  const stock = smokeStock && exhaustStock && slipstreamStock;
  const look = wheelSmokeLook(project.look);
  const clones = [];
  const textures = new Map();
  const columns = {};
  for (const target of WHEEL_SMOKE_TARGETS) {
    const active = !smokeStock && project[target.id];
    const value = !active ? target.stock : look.id === "none" ? "-" : target.clone;
    for (const column of target.columns) columns[column] = { stock: target.stock, value };
    /* Пробуксовка мотоцикла — то же правило, что у машины. */
    for (const column of target.burnoutColumns || []) {
      const burnout = WHEEL_SMOKE_TARGETS[0];
      const both = active && project.burnout;
      columns[column] = { stock: burnout.stock, value: !both ? burnout.stock : look.id === "none" ? "-" : burnout.clone };
    }
    if (!active || look.id === "none") continue;
    clones.push({ effect: target.clone, layers: wheelSmokeLayers(project, target) });
    if (look.glyph) {
      const glyph = WHEEL_GLYPHS[look.glyph];
      textures.set(glyph.texture, { texture: glyph.texture, glyph: look.glyph });
    }
  }
  /* Огонь выхлопа: правила, которые красятся, и замена имён в классах машин. */
  const vehicleEffects = [];
  for (const effect of WHEEL_SMOKE_EXHAUST) {
    const group = WHEEL_SMOKE_EXHAUST_GROUPS.find((item) => item.id === effect.group);
    const on = !exhaustStock && project[group.field];
    vehicleEffects.push({ stock: effect.stock, clone: effect.clone, value: on ? effect.clone : effect.stock });
    if (on) clones.push({ effect: effect.clone, layers: wheelSmokeExhaustLayers(project, effect) });
  }
  /* Воздушный пакет: клон под штатным именем. */
  const helperFeatures = [];
  if (!slipstreamStock) {
    clones.push({
      effect: WHEEL_SMOKE_SLIPSTREAM.clone,
      replaces: WHEEL_SMOKE_SLIPSTREAM.stock,
      layers: wheelSmokeSlipstreamLayers(project),
    });
    helperFeatures.push(...WHEEL_SMOKE_SLIPSTREAM.features);
    if (project.slipGlow !== 100) helperFeatures.push("effect-clone-emissive");
  }
  return {
    project,
    stock,
    smokeStock,
    exhaustStock,
    slipstreamStock,
    helperFeatures,
    clones,
    cloneReset: [WHEEL_SMOKE_PREFIX],
    textures: [...textures.values()],
    clipSheets: [...textures.values()].map((item) => ({ texture: item.texture, columns: 1, rows: 1 })),
    columns,
    vehicleVfx: { entry: VEHICLE_VFX_ENTRY, fields: [...VEHICLE_VFX_FIELDS], effects: vehicleEffects },
  };
}

/* ------------------------------ wheelfx.dat ------------------------------ */

const MATERIAL = /^[A-Z][A-Z0-9_]*$/;
const ROW_MIN_TOKENS = 29;

/* Строка на куски «текст + перевод строки»: перевод строки файла сохраняется. */
function splitLines(text) {
  return String(text).split(/(\r?\n)/);
}

/* Слова строки с их местом: правка меняет слово, не трогая табуляции. */
function tokensOf(line) {
  const tokens = [];
  const pattern = /\S+/g;
  let match;
  while ((match = pattern.exec(line))) tokens.push({ text: match[0], at: match.index });
  return tokens;
}

function replaceTokens(line, tokens, replacements) {
  let result = "";
  let cursor = 0;
  tokens.forEach((token, index) => {
    if (!(index in replacements)) return;
    result += line.slice(cursor, token.at) + replacements[index];
    cursor = token.at + token.text.length;
  });
  return result + line.slice(cursor);
}

const sameName = (left, right) => String(left).toLowerCase() === String(right).toLowerCase();

/**
 * wheelfx.dat с дымом работы: в столбцах целей штатное имя ↔ имя клона (или
 * «-»). Своё прежнее (`astral_wheel_*`, «-» там, где мы его ставили, нам не
 * узнать — поэтому «-» не трогается) сперва возвращается к штатному: правка
 * себя не копит, и «как в игре» возвращает таблицу игры.
 *
 * `columns` — из `compileWheelSmoke`. Ответ: `{ text, changed, rows,
 * matched }`; `matched` — сколько ячеек целей нашлось со штатным или своим
 * именем. Ноль при живой работе — таблица без дыма (оптимизация «без дыма
 * из-под колёс» или чужой мод): ставить некуда.
 */
export function patchWheelFx(text, columns) {
  const parts = splitLines(text);
  const clones = new Map(WHEEL_SMOKE_TARGETS.map((target) => [target.clone, target.stock]));
  let inside = false;
  let rows = 0;
  let changed = 0;
  let matched = 0;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const first = line.trim().split(/\s+/)[0] || "";
    if (/^VEHFX_INFO\w*_START$/.test(first)) {
      inside = true;
      continue;
    }
    if (/^VEHFX_INFO\w*_END$/.test(first)) {
      inside = false;
      continue;
    }
    if (!inside || !MATERIAL.test(first)) continue;
    const tokens = tokensOf(line);
    if (tokens.length < ROW_MIN_TOKENS) continue;
    rows += 1;
    const replacements = {};
    for (const [key, rule] of Object.entries(columns || {})) {
      const column = Number(key);
      const token = tokens[column];
      if (!token) continue;
      const current = clones.get(token.text.toLowerCase()) || token.text;
      if (!sameName(current, rule.stock)) continue;
      matched += 1;
      if (token.text !== rule.value) replacements[column] = rule.value;
    }
    if (!Object.keys(replacements).length) continue;
    parts[index] = replaceTokens(line, tokens, replacements);
    changed += 1;
  }
  if (!rows) throw new Error("wheelfx.dat: в файле игры нет таблицы материалов — другая сборка игры.");
  return { text: parts.join(""), changed, rows, matched };
}

/** Стоят ли в таблице клоны Astral. */
export const wheelFxHasClones = (text) => String(text).toLowerCase().includes(WHEEL_SMOKE_PREFIX);

/* ----------------------------- листы значков ----------------------------- */

/* Пятиконечная звезда: внешний и внутренний радиусы, верхний луч — вверх. */
function starPolygon(outer, inner) {
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 ? inner : outer;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points;
}

function insidePolygon(points, x, y) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* Сердце: (x² + y² − 1)³ − x²·y³ ≤ 0, ось y вверх. */
function insideHeart(x, y) {
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
}

const STAR = starPolygon(0.86, 0.36);

/* Внутри ли значка точка (−1…1, ось y вниз). */
function glyphCoverage(id, x, y) {
  if (id === "heart") return insideHeart(x * 1.2, -(y * 1.2) + 0.12);
  return insidePolygon(STAR, x, y + 0.06);
}

/**
 * Лист значка: белый значок с мягким ореолом на прозрачном, RGBA 8 бит.
 * Один и тот же у окна (кадр) и установщика (DDS в ядре): пиксели сверяются
 * тестом. Края — 4×4 выборки на точку.
 */
export function wheelGlyphSheet(id, edge = WHEEL_GLYPH_EDGE) {
  const size = Math.max(8, Math.min(512, Math.round(edge)));
  const rgba = new Uint8Array(size * size * 4);
  const samples = 4;
  for (let row = 0; row < size; row += 1)
    for (let column = 0; column < size; column += 1) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy += 1)
        for (let sx = 0; sx < samples; sx += 1) {
          const x = ((column + (sx + 0.5) / samples) / size) * 2 - 1;
          const y = ((row + (sy + 0.5) / samples) / size) * 2 - 1;
          if (glyphCoverage(id, x, y)) hits += 1;
        }
      const body = hits / (samples * samples);
      /* Ореол: мягкое свечение вокруг значка, к краю листа — ноль. */
      const cx = (column + 0.5) / size - 0.5;
      const cy = (row + 0.5) / size - 0.5;
      const halo = Math.max(0, 1 - Math.hypot(cx, cy) / 0.5) ** 2 * 0.35;
      const alpha = Math.min(1, body + halo * (1 - body));
      const at = (row * size + column) * 4;
      rgba[at] = 255;
      rgba[at + 1] = 255;
      rgba[at + 2] = 255;
      rgba[at + 3] = Math.round(alpha * 255);
    }
  return { width: size, height: size, rgba };
}

/* -------------------------------- шаблоны -------------------------------- */

/** Готовые работы на полке редактора. */
export const WHEEL_SMOKE_PRESETS = Object.freeze([
  Object.freeze({ id: "game", name: "Как в игре", project: Object.freeze({}) }),
  Object.freeze({ id: "neon-red", name: "Красный неон", project: Object.freeze({ colourMode: "one", colour: "#ff2a3c", opacity: 130, size: 115 }) }),
  Object.freeze({ id: "black", name: "Чёрный дым", project: Object.freeze({ colourMode: "one", colour: "#151515", opacity: 150, size: 120, length: 140 }) }),
  Object.freeze({ id: "rainbow", name: "Радужный дрифт", project: Object.freeze({ colourMode: "rainbow", colour: "#ff3b3b", opacity: 120 }) }),
  Object.freeze({ id: "duo", name: "Синий в розовый", project: Object.freeze({ colourMode: "two", colour: "#2f7bff", colour2: "#ff4fd8", opacity: 120 }) }),
  Object.freeze({ id: "stars", name: "Звёзды с искрами", project: Object.freeze({ look: "stars", colourMode: "one", colour: "#ffd34d", sparks: true }) }),
  Object.freeze({ id: "hearts", name: "Сердечки", project: Object.freeze({ look: "hearts", colourMode: "one", colour: "#ff4f8b", sparks: false, smoke: true }) }),
  Object.freeze({ id: "sparks", name: "Сноп искр", project: Object.freeze({ look: "sparks", colourMode: "game", density: 150 }) }),
  Object.freeze({ id: "fire", name: "Огненные колёса", project: Object.freeze({ look: "fire", colourMode: "game", smoke: true }) }),
  Object.freeze({ id: "none", name: "Без дыма", project: Object.freeze({ look: "none" }) }),
]);

/*
 * Готовые огни выхлопа на полке инструмента «Огонь выхлопа»: правят только
 * поля огня (`exhaust*`), дым работы не трогают.
 */
export const WHEEL_SMOKE_EXHAUST_PRESETS = Object.freeze([
  Object.freeze({ id: "game", name: "Как в игре", project: Object.freeze({}) }),
  Object.freeze({ id: "blue", name: "Синее пламя", project: Object.freeze({ exhaustColourMode: "one", exhaustColour: "#2f7bff", exhaustOpacity: 120 }) }),
  Object.freeze({ id: "toxic", name: "Ядовитый зелёный", project: Object.freeze({ exhaustColourMode: "one", exhaustColour: "#3dff5a", exhaustOpacity: 125 }) }),
  Object.freeze({ id: "pink", name: "Розовый неон", project: Object.freeze({ exhaustColourMode: "one", exhaustColour: "#ff4fd8", exhaustOpacity: 125 }) }),
  Object.freeze({ id: "violet", name: "Фиолетовый", project: Object.freeze({ exhaustColourMode: "one", exhaustColour: "#9b5cff", exhaustOpacity: 120 }) }),
  Object.freeze({ id: "duo", name: "Синий в фиолетовый", project: Object.freeze({ exhaustColourMode: "two", exhaustColour: "#2f7bff", exhaustColour2: "#9b5cff", exhaustOpacity: 120 }) }),
  Object.freeze({ id: "rainbow", name: "Радужный огонь", project: Object.freeze({ exhaustColourMode: "rainbow", exhaustColour: "#ff3b3b", exhaustSize: 120 }) }),
  Object.freeze({ id: "big", name: "Большое пламя", project: Object.freeze({ exhaustSize: 170, exhaustLength: 150, exhaustOpacity: 130 }) }),
]);

/*
 * Готовые воздушные пакеты на полке инструмента «Воздушный пакет»: правят
 * только поля пакета (`slip*`), дым и огонь работы не трогают.
 */
export const WHEEL_SMOKE_SLIPSTREAM_PRESETS = Object.freeze([
  Object.freeze({ id: "game", name: "Как в игре", project: Object.freeze({}) }),
  Object.freeze({ id: "neon-blue", name: "Голубой неон", project: Object.freeze({ slipColourMode: "one", slipColour: "#2fd4ff", slipOpacity: 150, slipGlow: 200 }) }),
  Object.freeze({ id: "red", name: "Красный след", project: Object.freeze({ slipColourMode: "one", slipColour: "#ff2a3c", slipOpacity: 160, slipGlow: 180, slipSize: 130 }) }),
  Object.freeze({ id: "gold", name: "Золотой", project: Object.freeze({ slipColourMode: "one", slipColour: "#ffd34d", slipOpacity: 150, slipGlow: 200 }) }),
  Object.freeze({ id: "duo", name: "Фиолетовый в розовый", project: Object.freeze({ slipColourMode: "two", slipColour: "#9b5cff", slipColour2: "#ff4fd8", slipOpacity: 150, slipGlow: 180 }) }),
  Object.freeze({ id: "rainbow", name: "Радужный воздух", project: Object.freeze({ slipColourMode: "rainbow", slipColour: "#ff3b3b", slipOpacity: 150, slipGlow: 150 }) }),
  Object.freeze({ id: "bold", name: "Густой и длинный", project: Object.freeze({ slipOpacity: 200, slipSize: 160, slipLength: 200, slipGlow: 150 }) }),
]);

/*
 * Поля работы по частям: дым работы, огонь выхлопа и воздушный пакет правятся
 * порознь, и «Вернуть как в игре» или шаблон одной части не трогает другие.
 */
const isExhaustField = (key) => key.startsWith("exhaust");
const isSlipstreamField = (key) => key.startsWith("slip");
export const wheelSmokeSmokeDefaults = () =>
  Object.fromEntries(Object.entries(WHEEL_SMOKE_DEFAULTS).filter(([key]) => !isExhaustField(key) && !isSlipstreamField(key)));
export const wheelSmokeExhaustDefaults = () => Object.fromEntries(Object.entries(WHEEL_SMOKE_DEFAULTS).filter(([key]) => isExhaustField(key)));
export const wheelSmokeSlipstreamDefaults = () => Object.fromEntries(Object.entries(WHEEL_SMOKE_DEFAULTS).filter(([key]) => isSlipstreamField(key)));
