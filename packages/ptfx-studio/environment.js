/*
 * Эффекты окружения: огонь, вспышки и свет, взрывы, дым и пар.
 *
 * В отличие от следа пули и эффектов попадания, здесь ничего не рисуется с
 * нуля: игра уже несёт в core.ypt свои листы спрайтов, и мастерская правит
 * именно их — оттенок, яркость и плотность. Правка — чистая функция над
 * пикселями, одна и та же в окне (превью) и в главном процессе (патч ядра): что
 * человек видит на экране, то и уходит в игру.
 *
 * Семейства собраны по тому, ЧТО рисует лист в игре, а не по его имени. Состав
 * сверен с живым ядром Legacy (107 текстур, 964 правила эффектов): для каждого
 * листа выписаны правила, которые его рисуют. Отсюда и неожиданные соседи:
 * `ptfx_muzzle_core_rgb` — это вовсе не только дульная вспышка, её рисуют
 * шестьдесят два эффекта, и почти все — вспышки пуль о металл и бетон;
 * `ptfx_firework_flare` в ядре рисует один рельсотрон, а не фейерверк.
 *
 * Первая версия знала четыре семейства на тридцать листов, и «перекрасить
 * огонь» красило разом костёр, свечу и форсаж самолёта. Теперь огня шесть
 * видов, а света и вспышек — пять: свечение, зарево взрывов, вспышки попаданий,
 * фаеры с лазерами и сами дульные вспышки. Нормали и карты искажения
 * (`*_n`, `ptfx_bullet_tacer_heat`) сюда не идут намеренно: это не цвет, а
 * преломление, и крашеная нормаль ломает марево, а не красит его.
 */

import { tintFamilyPixels } from "./family-tint.js";
import { parseColour, normalizeColour } from "./shapes.js";

/** Группы семейств — так их раскладывает инспектор. */
export const ENVIRONMENT_GROUPS = Object.freeze([
  Object.freeze({ id: "fire", label: "Огонь" }),
  Object.freeze({ id: "light", label: "Вспышки и свет" }),
  Object.freeze({ id: "explosion", label: "Взрывы" }),
  Object.freeze({ id: "smoke", label: "Дым и пар" }),
]);

const family = (
  id,
  group,
  label,
  description,
  textures,
  preview = textures[0],
) =>
  Object.freeze({
    id,
    group,
    label,
    description,
    /* Лист, по которому семейство узнают на сцене. */
    preview,
    textures: Object.freeze(textures),
  });

export const ENVIRONMENT_FAMILIES = Object.freeze([
  /* ── огонь ── */
  family(
    "fire",
    "fire",
    "Пламя пожаров",
    "Костры, горящие бочки и пожары в зданиях — большое пламя игры",
    ["ptfx_fire_v2", "ptfx_fire_v3"],
  ),
  family(
    "flame",
    "fire",
    "Пламя техники",
    "Горящие машины и бензобаки, камины, барбекю и коктейль Молотова",
    ["ptfx_flipbook_fire_rgb", "ptfx_flipbook_fire1_rgb"],
  ),
  family(
    "fire-trail",
    "fire",
    "Огненные хвосты",
    "Горящие обломки взрывов и пламя факела",
    ["ptfx_fire_tail", "ptfx_ribbon_fire"],
  ),
  family(
    "embers",
    "fire",
    "Угольки",
    "Искры над любым огнём: костры, пожары и взрывы",
    ["ptfx_embers_rgb"],
  ),
  family(
    "candle",
    "fire",
    "Свеча и сварка",
    "Язычок свечи и пламя сварочной горелки",
    ["ptfx_ribbon_candle_flame"],
  ),
  /* Форсаж — самое настоящее пламя игры, просто редкое: его видно только из
     сопла реактивного самолёта на разгоне (Lazer, Hydra, Besra, Rogue) и у
     ракет. Подпись называет это прямо — иначе слово «форсаж» в ряду костров и
     свечей читается как что-то постороннее. */
  family(
    "afterburner",
    "fire",
    "Форсаж",
    "Пламя из сопла реактивных самолётов на разгоне — Lazer, Hydra, Besra — и хвост ракет",
    ["ptfx_afterburner_rings_rgb", "ptfx_model_afterburner"],
  ),
  /* ── вспышки и свет ── */
  family(
    "muzzle",
    "light",
    "Вспышки выстрелов",
    "Огонь из ствола: пистолеты, автоматы, миниган и танк",
    ["ptfx_muzzle_01", "ptfx_muzzle_02", "ptfx_muzzle_core_02"],
    "ptfx_muzzle_02",
  ),
  family(
    "impact-flash",
    "light",
    "Вспышки попаданий",
    "Вспышка пули о металл и бетон, искрящая проводка и сварка",
    ["ptfx_muzzle_core_rgb", "ptfx_glow_impact_rgb"],
  ),
  family(
    "glow",
    "light",
    "Свечение",
    "Ореол огня, свечей, электричества и искр — больше ста эффектов игры",
    ["ptfx_glow_rgb", "ptfx_glow"],
  ),
  family(
    "explosion-glow",
    "light",
    "Зарево взрывов",
    "Вспышка-зарево гранат, ракет и машин, светошумовая и рельсотрон",
    ["ptfx_flat_glow_rgb", "ptfx_glow_flat_rgb"],
  ),
  family(
    "flare",
    "light",
    "Фаеры и лазеры",
    "Сигнальный фаер, лучи лазеров, выхлоп космолёта и вспышка рельсотрона",
    [
      "ptfx_flare",
      "ptfx_starbursts_rgb",
      "ptfx_star_rgb",
      "ptfx_firework_flare",
    ],
  ),
  /* ── взрывы ── */
  /*
   * Взрыв — то, что в нём светится. Обломки (`ptfx_*_debris`, `ptfx_rubble`)
   * сюда не идут намеренно: это куски земли и металла, и крашеный в цвет
   * взрыва мусор выглядит поломкой, а не эффектом.
   */
  family(
    "explosion",
    "explosion",
    "Огненные шары",
    "Шары огня гранат, ракет, машин и коктейля Молотова",
    [
      "_explosion_fireball",
      "_explosion_fireball_rgba",
      "_explosion_clown_fireball_rgba",
    ],
    "_explosion_fireball_rgba",
  ),
  family(
    "sparks",
    "explosion",
    "Искры",
    "Снопы искр, электрические дуги шокера и разрядов",
    ["ptfx_sparks", "ptfx_sparks_arcing_anim", "ptfx_exp_spark_glows"],
  ),
  /* ── дым и пар ── */
  family(
    "smoke",
    "smoke",
    "Дым",
    "Выстрелы, выхлоп, дрифт и пожары — у игры это один дым",
    [
      "ptfx_smoke_sheet_6",
      "ptfx_smoke_loop",
      "ptfx_smoke_new_plumes",
      "ptfx_smoke_thin_anim",
      "ptfx_smoke_wispy_anim",
      "ptfx_smoke_billow_anim_rgba",
      "ptfx_smoke_static_rgba",
      "ptfx_smoke_spikes",
      "ptfx_ribbon_smoke",
    ],
    "ptfx_smoke_loop",
  ),
  family(
    "steam",
    "smoke",
    "Пар и дымка",
    "Пар из труб и люков, брызги водопадов и сигаретный дым",
    ["ptfx_steam_anim", "ptfx_cig_smoke_sheet", "ptfx_multi_sheet_006_mist"],
  ),
]);

/*
 * Семейства первой версии → нынешние. Прежний «огонь» красил всё пламя разом,
 * прежний «взрыв» — и шары, и искры; сохранённый проект той поры обязан
 * красить то же, что красил.
 */
const FIRST_FAMILIES = Object.freeze({
  smoke: ["smoke"],
  muzzle: ["muzzle", "impact-flash"],
  fire: ["fire", "flame", "fire-trail", "embers", "candle", "afterburner"],
  explosion: ["explosion", "sparks"],
});

/** Раздел окружения проекта первой схемы в нынешних семействах. */
export function migrateEnvironment(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const next = {};
  for (const [id, settings] of Object.entries(input)) {
    for (const target of FIRST_FAMILIES[id] || [id]) next[target] = settings;
  }
  return next;
}

export const ENVIRONMENT_FAMILY_IDS = Object.freeze(
  ENVIRONMENT_FAMILIES.map((family) => family.id),
);

export const findEnvironmentFamily = (id) =>
  ENVIRONMENT_FAMILIES.find((family) => family.id === id) || null;

/* Пределы ползунков. Яркость и плотность идут выше единицы: «сделать дым
   гуще, чем в оригинале» — самая частая просьба, и запирать её на 100 %
   значило бы оставить половину модов недостижимыми. */
export const ENVIRONMENT_LIMITS = Object.freeze({
  tintStrength: Object.freeze({ min: 0, max: 1 }),
  brightness: Object.freeze({ min: 0.2, max: 2 }),
  opacity: Object.freeze({ min: 0.2, max: 1.5 }),
});

/*
 * «Убрать огонь совсем» (ТЗ 17.10.2026, вечер): листы огня гасятся — чёрные и
 * прозрачные, и спрайт не виден. Это пламя пожаров и техники, огненные хвосты,
 * свеча и сварка и огненные шары взрывов. Форсаж самолётов, угольки, искры,
 * дым и свечение остаются: это другие листы, и «огонь» в разговоре людей —
 * именно язык пламени. Механику огня (поджог, урон, пожары) файл листов не
 * трогает — огонь жжёт, даже когда его не видно.
 */
export const FIRE_REMOVED_FAMILIES = Object.freeze([
  "fire",
  "flame",
  "fire-trail",
  "candle",
  "explosion",
]);

/** Убран ли огонь совсем: все семейства огня несут `remove`. */
export const fireIsRemoved = (environment) =>
  FIRE_REMOVED_FAMILIES.every(
    (id) => environment?.[id]?.enabled && environment[id].remove === true,
  );

/**
 * Семейства убраны или возвращены: поле `remove` ставится им и снимается с них; цвет, яркость и плотность остаются
 * как были. У каждого семейства оно своё — установка гасит листы только тех, у кого оно стоит.
 */
export function withFamiliesRemoved(environment, ids, on) {
  const next = { ...environment };
  for (const id of ids) {
    const { remove: _remove, ...rest } = next[id] || defaultFamilySettings();
    next[id] = on ? { ...rest, enabled: true, remove: true } : rest;
  }
  return next;
}

/** Огонь убран или возвращён разом у пяти семейств огня (`FIRE_REMOVED_FAMILIES`). */
export const withFireRemoved = (environment, on) => withFamiliesRemoved(environment, FIRE_REMOVED_FAMILIES, on);

/** Одно семейство убрано или возвращено (ТЗ 23.10.2026, п. E: у каждого семейства свой выключатель). */
export const withFamilyRemoved = (environment, id, on) => withFamiliesRemoved(environment, [id], on);

/** «Отключить все эффекты»: убраны или возвращены все семейства — огонь, вспышки и свет, взрывы, дым и пар. */
export const withEffectsOff = (environment, on) => withFamiliesRemoved(environment, ENVIRONMENT_FAMILY_IDS, on);

/** Убрано ли семейство: оно включено и несёт `remove`. */
export const familyIsRemoved = (environment, id) => Boolean(environment?.[id]?.enabled && environment[id].remove === true);

/** Все ли эффекты окружения отключены. */
export const effectsAreOff = (environment) => ENVIRONMENT_FAMILY_IDS.every((id) => familyIsRemoved(environment, id));

export function defaultFamilySettings() {
  return {
    enabled: false,
    tint: "#ffffff",
    tintStrength: 0,
    brightness: 1,
    opacity: 1,
  };
}

export function defaultEnvironment() {
  return Object.fromEntries(
    ENVIRONMENT_FAMILY_IDS.map((id) => [id, defaultFamilySettings()]),
  );
}

function bounded(value, fallback, { min, max }, label) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label}: допустимо от ${min} до ${max}.`);
  }
  return Math.round(number * 100) / 100;
}

function parseFamilySettings(id, input) {
  const base = defaultFamilySettings();
  if (!input) return base;
  const family = findEnvironmentFamily(id);
  const unknown = Object.keys(input).find(
    (key) => key !== "remove" && !Object.keys(base).includes(key),
  );
  if (unknown) {
    throw new Error(`${family.label}: лишнее поле «${unknown}».`);
  }
  return {
    enabled: input.enabled === true,
    tint:
      input.tint === undefined || input.tint === null
        ? base.tint
        : normalizeColour(input.tint),
    tintStrength: bounded(
      input.tintStrength,
      base.tintStrength,
      ENVIRONMENT_LIMITS.tintStrength,
      `${family.label}: сила оттенка`,
    ),
    brightness: bounded(
      input.brightness,
      base.brightness,
      ENVIRONMENT_LIMITS.brightness,
      `${family.label}: яркость`,
    ),
    opacity: bounded(
      input.opacity,
      base.opacity,
      ENVIRONMENT_LIMITS.opacity,
      `${family.label}: плотность`,
    ),
    /* Только у включённого, без смены схемы: прежние работы остаются прежними. */
    ...(input.remove === true ? { remove: true } : {}),
  };
}

/** Разбирает раздел окружения; неизвестное семейство — ошибка. */
export function parseEnvironment(input) {
  const base = defaultEnvironment();
  if (!input) return base;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Раздел окружения должен быть объектом.");
  }
  const unknown = Object.keys(input).find(
    (key) => !ENVIRONMENT_FAMILY_IDS.includes(key),
  );
  if (unknown) throw new Error(`Неизвестное семейство эффектов: ${unknown}`);
  return Object.fromEntries(
    ENVIRONMENT_FAMILY_IDS.map((id) => [
      id,
      parseFamilySettings(id, input[id]),
    ]),
  );
}

/** Включённое семейство со штатными ползунками ничего не меняет в игре. */
export function familyChanged(settings) {
  return Boolean(
    settings?.enabled &&
    (settings.remove === true ||
      settings.tintStrength > 0 ||
      settings.brightness !== 1 ||
      settings.opacity !== 1),
  );
}

/** Семейства, которые установка действительно перепишет. */
export function changedFamilies(environment) {
  return ENVIRONMENT_FAMILY_IDS.filter((id) =>
    familyChanged(environment?.[id]),
  );
}

/**
 * Правка пикселей семейства.
 *
 * Порядок фиксирован: сначала яркость, потом оттенок, потом плотность.
 * Оттенок ложится через светлоту: пиксель тянется к «своей светлоте в цвете
 * оттенка», поэтому форма клуба дыма сохраняется, а не заливается плоским
 * цветом. Плотность — это альфа; у форматов без альфы (DXT1 — так лежат
 * листы огня и RGB-листы) она честно превращается в яркость: другого канала,
 * которым игра гасит такой спрайт, у них нет.
 */
export function applyFamilyTint(rgba, settings, { format = "DXT5" } = {}) {
  /* «Убрать совсем» — без разбора цвета: лист гаснет целиком. Цикл — `family-tint.js`. */
  if (settings.remove === true) return new Uint8ClampedArray(rgba.length);
  return tintFamilyPixels(rgba, parseColour(settings.tint), settings, format);
}

/** Что установка перепишет в ядре: по одной записи на текстуру семейства. */
export function environmentPlan(environment) {
  const plan = [];
  for (const id of changedFamilies(environment)) {
    const family = findEnvironmentFamily(id);
    for (const texture of family.textures) {
      plan.push({ family: id, texture, settings: { ...environment[id] } });
    }
  }
  return plan;
}

/*
 * Объёмное превью семейства (задача 7 ТЗ 05.10.2026): не лист, а сам эффект
 * игры, который этот лист рисует, — огонь, дым и взрыв в 3D.
 *
 * Кандидаты — по порядку предпочтения: долгие и стоящие на земле (пожар,
 * костёр) раньше коротких вспышек. Главный процесс выгружает их из ядра
 * игрока (`ypt-rule-export`, чего в ядре нет — уходит в `missing`), окно
 * берёт первый, чьи частицы рисуют листы этого семейства
 * (`pickEnvironmentEffect`): так правка оттенка в кадре видна на нём.
 */
export const ENVIRONMENT_PREVIEW = Object.freeze({
  fire: Object.freeze(["fire_map", "fire_object", "ent_amb_fbi_fire_lg", "ent_amb_fbi_fire_wall_lg", "ent_amb_beach_campfire", "ent_amb_barrel_fire", "ent_ray_heli_aprtmnt_h_fire", "ent_dst_elec_fire", "fire_wrecked_car", "fire_petroltank_car"]),
  flame: Object.freeze(["ent_sht_flame", "fire_wrecked_car", "fire_petroltank_car", "fire_wrecked_plane_cockpit", "ent_amb_int_fireplace", "ent_anim_bbq", "proj_molotov_flame", "exp_air_molotov"]),
  "fire-trail": Object.freeze(["ent_amb_torch_fire", "proj_molotov_trail", "sp_fire_trail_heli", "sp_fire_trail_plane", "fire_ped_body", "exp_grd_vehicle"]),
  embers: Object.freeze(["ent_amb_beach_campfire", "ent_ray_heli_aprtmnt_embers", "fire_map", "ent_amb_fbi_fire_lg", "exp_air_grenade"]),
  /* Сварка раньше свечи (задача 3 ТЗ 06.10.2026): горелка — голубое пламя
     того же листа и искры, свеча — пламя в три сантиметра. */
  candle: Object.freeze(["ent_anim_welder", "ent_amb_welding", "ent_amb_candle_flame", "ent_anim_cig_smoke"]),
  afterburner: Object.freeze(["veh_exhaust_afterburner", "veh_exhaust_jet", "proj_rpg_trail", "proj_missile_trail"]),
  muzzle: Object.freeze(["muz_assault_rifle", "muz_pistol", "muz_smg", "muz_shotgun", "muz_minigun", "muz_tank"]),
  "impact-flash": Object.freeze(["bul_carmetal", "bul_metal", "bul_concrete", "ent_sht_electrical_box"]),
  /* Свечение — горящий фальшфейер: его ореол (~0,9 м) виден в 98 % кадров,
     а у разового `sp_ent_sparking_wires` — в 37 % и с полметра (сверено
     прогоном частиц ядра 06.10.2026). */
  glow: Object.freeze(["exp_grd_flare", "ent_amb_elec_crackle_sp", "sp_ent_sparking_wires", "ent_amb_elec_crackle"]),
  "explosion-glow": Object.freeze(["exp_grd_grenade", "exp_grd_rpg", "exp_grd_petrol_pump", "exp_arc_grd_flashbang", "exp_air_molotov"]),
  flare: Object.freeze(["proj_flare_fuse", "exp_grd_flare", "proj_flare_trail", "weap_heist_flare_trail", "muz_railgun"]),
  explosion: Object.freeze(["exp_grd_grenade", "exp_grd_vehicle", "exp_grd_rpg", "exp_grd_petrol_pump", "exp_grd_plane", "exp_air_grenade", "exp_air_molotov"]),
  sparks: Object.freeze(["ent_amb_sparking_wires", "sp_foundry_sparks", "ent_amb_elec_crackle_sp", "ent_sht_electrical_box", "bul_stungun_metal", "shotgun_water"]),
  smoke: Object.freeze(["ent_amb_smoke_general", "ent_amb_smoke_foundry", "fire_ped_smoulder", "env_gunsmoke", "ent_dst_electrical", "fire_wrecked_car"]),
  steam: Object.freeze(["ent_amb_steam", "ent_amb_steam_vent_round", "ent_amb_steam_pipe", "ent_brk_steam_burst", "ent_amb_cig_smoke"]),
});

/** Кандидаты превью порциями: выгрузка с порождёнными эффектами держит до 128 правил. */
export function environmentPreviewBatches(limit = 32) {
  const names = [...new Set(Object.values(ENVIRONMENT_PREVIEW).flat())];
  const batches = [];
  for (let index = 0; index < names.length; index += limit) batches.push(names.slice(index, index + limit));
  return batches;
}

const lowerList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/* Эффект и частица из выгрузок (сырых, как их отдаёт помощник). */
const exportedEffect = (exports, name) => {
  for (const exported of exports || []) if (exported?.effects?.[name]) return exported.effects[name];
  return null;
};
const exportedParticle = (exports, name) => {
  for (const exported of exports || []) if (exported?.particles?.[name]) return exported.particles[name];
  return null;
};

/**
 * Листы, которые рисует эффект: текстуры цвета его частиц и частиц
 * эффектов, которые они порождают (имена строчными).
 */
export function effectTextures(exports, name, seen = new Set()) {
  if (!name || seen.has(name)) return new Set();
  seen.add(name);
  const effect = exportedEffect(exports, name);
  const out = new Set();
  for (const event of lowerList(effect?.EventEmitters)) {
    const particle = exportedParticle(exports, String(event?.ParticleRule || ""));
    if (!particle) continue;
    for (const item of lowerList(particle.ShaderVars))
      if (String(item?.Type) === "Texture" && /^diffusetex/i.test(String(item?.Name || "")) && item.TextureName)
        out.add(String(item.TextureName).toLowerCase());
    for (const spawner of [particle.EffectSpawnerAtRatio, particle.EffectSpawnerOnCollision])
      for (const texture of effectTextures(exports, String(spawner?.EffectRule || ""), seen)) out.add(texture);
  }
  return out;
}

/** Эффект превью семейства: первый кандидат, чьи частицы рисуют его листы; `""` — такого нет. */
export function pickEnvironmentEffect(exports, familyId) {
  const family = findEnvironmentFamily(familyId);
  if (!family) return "";
  const own = new Set(family.textures.map((name) => name.toLowerCase()));
  for (const name of ENVIRONMENT_PREVIEW[familyId] || []) {
    if (!exportedEffect(exports, name)) continue;
    for (const texture of effectTextures(exports, name)) if (own.has(texture)) return name;
  }
  return "";
}
