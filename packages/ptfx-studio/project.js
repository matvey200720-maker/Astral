/*
 * Проект мастерской эффектов: что именно выбрал игрок.
 *
 * Проект — это настройки, а не файлы. В нём нет ни DDS, ни строк bloodfx.dat:
 * из него всё пересобирается заново на базе, прочитанной из игры. Поэтому
 * проект переживает обновление GTA, переносится кодом на другой компьютер и
 * ложится в пресет размером в пару килобайт.
 *
 * Разбор строгий: неизвестное поле — ошибка, а не «пропустим». Тихо
 * проглоченная опечатка в пресете означала бы, что человек поставил не то, что
 * видел на экране.
 */

import { BLOOD_WEAPON_GROUPS, BLOODFX_TABLES } from "@modovik/bloodfx";
import {
  ASTRAL_TRACER_SLOTS,
  STUDIO_TRACER_WEAPON_IDS,
  TRACER_OWN_RADIUS,
  TRACER_OWN_SHOTS,
} from "@modovik/tracer-contract";
import {
  TRACER_COLOUR_LIMIT,
  TRACER_COLOUR_MODE_IDS,
  findTracerStyle,
  normalizeColour,
} from "./shapes.js";
import {
  IMPACT_ZONE_IDS,
  defaultImpactZone,
  impactZoneChanged,
  parseImpactZone,
} from "./impact.js";
import {
  MUZZLE_QUIET_ALL,
  defaultMuzzleFlash,
  defaultMuzzleSmoke,
  muzzleWeaponCount,
  parseMuzzle,
  patchMuzzleList,
  quietWeapons,
  serializeMuzzle,
} from "./muzzle.js";
import {
  ENVIRONMENT_FAMILY_IDS,
  changedFamilies,
  defaultEnvironment,
  migrateEnvironment,
  parseEnvironment,
} from "./environment.js";

/*
 * Схема 5 — след пули стал списком трассеров (`tracer.profiles`): у каждого
 * свой вид, цвета (один, переход или радуга), размер, шанс и своё оружие, а
 * оружие — все пули игры, не только базовые. Схема 4 — у слоя попадания
 * сторона (спереди/сзади), какая кровь, режим цвета и свечение; схема 3
 * принесла стопку слоёв и дальность зоны; схема 2 несла один вид на зону,
 * схема 1 — шесть зон с нарисованными брызгами. Проекты и коды обмена
 * прежних схем открываются: один след прежних схем становится первым
 * трассером списка (`migrateTracer`), слою третьей схемы новые поля
 * достаются умолчаниями, зона второй становится стопкой из одного слоя
 * (`parseImpactZone`), зоны первой сводятся к двум (`migrateImpact`).
 * Окружение не менялось.
 */
export const PTFX_PROJECT_SCHEMA = 5;
const READABLE_SCHEMAS = Object.freeze([1, 2, 3, 4, PTFX_PROJECT_SCHEMA]);

const weaponIds = new Set(STUDIO_TRACER_WEAPON_IDS);
/* Трассеров не больше, чем слотов в ядре: у каждого своё правило и текстура. */
export const TRACER_PROFILE_LIMIT = ASTRAL_TRACER_SLOTS.length;
const zoneIds = IMPACT_ZONE_IDS;
const groupIds = BLOOD_WEAPON_GROUPS.map((group) => group.id);
const stateIds = BLOODFX_TABLES.map((table) => table.id);

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

function unit(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${label}: допустимо от 0 до 1.`);
  }
  // Ползунки хранятся с двумя знаками: этого хватает глазу и делает
  // одинаковые настройки действительно одинаковыми при сравнении.
  return Math.round(clamp01(number) * 100) / 100;
}

function colour(value, fallback, _label) {
  if (value === undefined || value === null) return fallback;
  return normalizeColour(value);
}

function names(value, allowed, label) {
  const source = Array.isArray(value) ? value.map(String) : [];
  const result = [...new Set(source)];
  const unknown = result.find((item) => !allowed.includes(item));
  if (unknown) throw new Error(`${label}: неизвестное значение «${unknown}».`);
  return result.sort(
    (left, right) => allowed.indexOf(left) - allowed.indexOf(right),
  );
}

/*
 * Выстрел стволов — вспышка, её свет, дым из ствола и гильзы (`muzzle.js`).
 * Установщик снимает клоны с того, что стоит у ствола в игре
 * (`tracer-contract`, `muzzleCloneName`, `smokeCloneName`).
 */
export {
  MUZZLE_FLASH_LIMIT,
  MUZZLE_RANGE,
  MUZZLE_SPEED_PROP,
  defaultMuzzleFlash,
  defaultMuzzleSmoke,
  muzzleFlashOf,
  muzzleSmokeOf,
  muzzleShellOf,
  MUZZLE_QUIET_ALL,
  muzzleHasEdits,
  muzzleQuietAll,
  muzzleQuietOf,
  quietWeapons,
} from "./muzzle.js";

/**
 * «Без вспышки и дыма»: `weapon` — ствол или `"all"` (все стволы
 * мастерской), `on` — выключить (`true`) или вернуть штатные (`false`).
 */
export function withMuzzleQuiet(project, weapon, on) {
  const parsed = parseProject(project);
  const all = weapon === MUZZLE_QUIET_ALL;
  let quiet;
  if (all) quiet = on ? MUZZLE_QUIET_ALL : [];
  else {
    /* Из «все стволы» один ствол выходит списком всех остальных. */
    const list = new Set(quietWeapons(parsed.muzzle));
    if (on) list.add(weapon);
    else list.delete(weapon);
    quiet = parsed.muzzle.quiet === MUZZLE_QUIET_ALL && on ? MUZZLE_QUIET_ALL : [...list];
  }
  return serializeProject({ ...parsed, muzzle: { ...parsed.muzzle, quiet } });
}

/**
 * Проект с новой вспышкой ствола: `patch` дописывается к нынешней (или к
 * умолчанию), `null` — вспышка снимается, ствол снова штатный.
 */
export function withMuzzleFlash(project, weapon, patch) {
  const parsed = parseProject(project);
  const flashes = patchMuzzleList(
    parsed.muzzle.flashes,
    weapon,
    patch,
    defaultMuzzleFlash(weapon),
  );
  return serializeProject({ ...parsed, muzzle: { ...parsed.muzzle, flashes } });
}

/** Проект со своим дымом ствола; `null` — дым снова штатный. */
export function withMuzzleSmoke(project, weapon, patch) {
  const parsed = parseProject(project);
  const smokes = patchMuzzleList(
    parsed.muzzle.smokes,
    weapon,
    patch,
    defaultMuzzleSmoke(weapon),
  );
  return serializeProject({ ...parsed, muzzle: { ...parsed.muzzle, smokes } });
}

/** Проект со своими гильзами ствола (`id` вида); `null` — штатные. */
export function withMuzzleShell(project, weapon, shell) {
  const parsed = parseProject(project);
  const shells = patchMuzzleList(
    parsed.muzzle.shells,
    weapon,
    shell === null || shell === undefined ? null : { shell },
    { weapon, shell: "" },
  );
  return serializeProject({ ...parsed, muzzle: { ...parsed.muzzle, shells } });
}

/** Выстрел ствола целиком штатный: вспышка, свет, дым и гильзы. */
export function withoutWeaponMuzzle(project, weapon) {
  const parsed = parseProject(project);
  const keep = (list) => list.filter((item) => item.weapon !== weapon);
  return serializeProject({
    ...parsed,
    muzzle: {
      flashes: keep(parsed.muzzle.flashes),
      smokes: keep(parsed.muzzle.smokes),
      shells: keep(parsed.muzzle.shells),
      /* Тишина ствола — его выстрел тоже. «Все стволы» — общая галка, её
         правка одного ствола не снимает. */
      quiet:
        parsed.muzzle.quiet === MUZZLE_QUIET_ALL
          ? MUZZLE_QUIET_ALL
          : parsed.muzzle.quiet.filter((item) => item !== weapon),
    },
  });
}

function boundedText(value, fallback, max) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (text.length > max) throw new Error(`Название длиннее ${max} символов.`);
  return text;
}

/*
 * Один трассер: вид, цвета, размер, шанс и оружие.
 *
 * Новый трассер приходит с «выбранным» оружием, но без единого ствола: он
 * ничего не ставит, пока человек не отметит, для чего он. Это и есть «пустой
 * экран» на входе — след виден на стрельбище, но в игру не едет, и обещать
 * нечего (владелец, 23.09.2026). «Всё оружие» — сознательный выбор.
 */
export function defaultTracerProfile(index = 0) {
  return {
    id: `tracer-${index + 1}`,
    style: "classic",
    colours: ["#ff7a1a"],
    colourMode: "solid",
    coreColour: "#ffffff",
    thickness: 0.45,
    length: 0.6,
    glow: 0.5,
    chanceSP: 1,
    chanceMP: 1,
    /* Свои выстрелы (задача 14 ТЗ 10.10.2026): «show» — след у всех, и у
       своих; «hide» — только у чужих (`TRACER_NEAR_HIDE` в tracer-contract). */
    ownShots: "show",
    /* «Свои» — следы, прошедшие ближе этого к камере, метры (`TRACER_OWN_RADIUS`). */
    ownShotsRadius: TRACER_OWN_RADIUS.standard,
    mode: "selected",
    weapons: [],
  };
}

/** След пули: список трассеров, всегда хотя бы один — есть что править. */
export function defaultTracer() {
  return { profiles: [defaultTracerProfile(0)] };
}

/** Выключен ли след у трассера: «Без трассера» — у его стволов следа не будет. */
export const tracerProfileOff = (profile) => profile?.off === true;

/** Едет ли трассер в игру: у него есть оружие. */
export const tracerProfileActive = (profile) =>
  Boolean(profile) &&
  (profile.mode === "all" || (profile.weapons || []).length > 0);

/** Первый цвет трассера — для меток и обложек. */
export const tracerProfileColour = (profile) =>
  profile?.colours?.[0] || profile?.colour || "#ff7a1a";

/*
 * Оружие каждого трассера, как оно уйдёт в игру. «Всё оружие» — все стволы,
 * кроме тех, что другие трассеры забрали себе поимённо: так у человека один
 * трассер «на всё остальное» и особые — для снайперки и карабина.
 */
export function tracerAssignments(tracer) {
  const profiles = tracer?.profiles || [];
  const taken = new Set(
    profiles
      .filter((profile) => profile.mode !== "all")
      .flatMap((profile) => profile.weapons || []),
  );
  return profiles
    .map((profile) => ({
      profile,
      weapons:
        profile.mode === "all"
          ? STUDIO_TRACER_WEAPON_IDS.filter((id) => !taken.has(id))
          : [...(profile.weapons || [])],
    }))
    .filter((item) => item.weapons.length > 0);
}

export const defaultZone = defaultImpactZone;

export function defaultImpact() {
  return {
    enabled: false,
    states: ["alive", "dead", "alive-mp", "dead-mp"],
    weaponGroups: ["firearms", "shotgun", "sniper"],
    zones: Object.fromEntries(zoneIds.map((id) => [id, defaultZone(id)])),
  };
}

/** Пустой проект. */
export function createProject(name = "Мои эффекты") {
  return {
    schema: PTFX_PROJECT_SCHEMA,
    name: boundedText(name, "Мои эффекты", 80),
    tracer: defaultTracer(),
    impact: defaultImpact(),
    environment: defaultEnvironment(),
  };
}

const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/i;

function parseTracerProfile(input, index) {
  const base = defaultTracerProfile(index);
  if (!input || typeof input !== "object")
    throw new Error(`Трассер ${index + 1}: ожидались настройки.`);
  const id =
    input.id === undefined || input.id === null ? base.id : String(input.id);
  if (!PROFILE_ID.test(id))
    throw new Error(`Трассер ${index + 1}: непонятный идентификатор «${id}».`);
  const style = input.style === undefined ? base.style : String(input.style);
  if (!findTracerStyle(style))
    throw new Error(`Неизвестный вид трассера: ${style}`);
  /* `colour` — одиночный цвет прежних схем; `colours` — список нынешней. */
  const rawColours = Array.isArray(input.colours)
    ? input.colours
    : input.colour !== undefined
      ? [input.colour]
      : base.colours;
  if (!rawColours.length || rawColours.length > TRACER_COLOUR_LIMIT)
    throw new Error(
      `Трассер ${index + 1}: цветов от одного до ${TRACER_COLOUR_LIMIT}.`,
    );
  const colours = rawColours.map((value) =>
    colour(value, base.colours[0], "Цвет трассера"),
  );
  const colourMode =
    input.colourMode === undefined ? base.colourMode : String(input.colourMode);
  if (!TRACER_COLOUR_MODE_IDS.includes(colourMode))
    throw new Error(`Неизвестный режим цвета трассера: ${colourMode}`);
  const mode = input.mode === "all" ? "all" : "selected";
  const weapons = names(input.weapons, [...weaponIds], "Оружие трассера");
  return {
    id,
    style,
    colours,
    colourMode,
    coreColour: colour(input.coreColour, base.coreColour, "Цвет сердцевины"),
    thickness: unit(input.thickness, base.thickness, "Толщина"),
    length: unit(input.length, base.length, "Длина"),
    glow: unit(input.glow, base.glow, "Свечение"),
    chanceSP: unit(input.chanceSP, base.chanceSP, "Шанс в одиночной игре"),
    chanceMP: unit(input.chanceMP, base.chanceMP, "Шанс в сетевой игре"),
    ownShots: ownShotsOf(input.ownShots, base.ownShots, index),
    ownShotsRadius: ownRadiusOf(input.ownShotsRadius, base.ownShotsRadius, index),
    mode,
    weapons,
    /* «Без трассера» (ТЗ 17.10.2026, вечер): у стволов трассера в игре нет
       следа. Поле есть только у включённого — без смены схемы: канонический
       вид прежних работ остаётся прежним. Вид, цвета и размер хранятся, пока
       след выключен, и вернутся с ним. */
    ...(input.off === true ? { off: true } : {}),
  };
}

/* Радиус своих выстрелов: метры на шаге 0,5 в пределах договора. */
function ownRadiusOf(value, fallback, index) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < TRACER_OWN_RADIUS.min || number > TRACER_OWN_RADIUS.max)
    throw new Error(
      `Трассер ${index + 1}: «свои» — от ${TRACER_OWN_RADIUS.min} до ${TRACER_OWN_RADIUS.max} м от камеры.`,
    );
  return Math.round(number / TRACER_OWN_RADIUS.step) * TRACER_OWN_RADIUS.step;
}

/* Свои выстрелы: «show» или «hide»; прежние проекты — «show», как было. */
function ownShotsOf(value, fallback, index) {
  if (value === undefined || value === null) return fallback;
  const text = String(value);
  if (!TRACER_OWN_SHOTS.includes(text))
    throw new Error(`Трассер ${index + 1}: непонятно, чьи выстрелы со следом («${text}»).`);
  return text;
}

/*
 * След прежних схем — одно правило на всё: `enabled`, вид, цвет, оружие.
 * Он становится первым трассером списка. Выключенный след прежде ничего не
 * ставил, и здесь он не ставит: оружия у него не остаётся.
 */
function migrateTracer(input) {
  if (!input || typeof input !== "object") return null;
  const enabled = input.enabled === true;
  const { enabled: _enabled, ...rest } = input;
  /* Оружие проверяется и у выключенного следа: неизвестный ствол — ошибка
     пресета, а не то, что можно молча выбросить. */
  const weapons = names(input.weapons, [...weaponIds], "Оружие трассера");
  return {
    profiles: [
      {
        ...rest,
        mode: enabled
          ? input.mode === "selected"
            ? "selected"
            : "all"
          : "selected",
        weapons: enabled ? weapons : [],
      },
    ],
  };
}

function parseTracer(input) {
  if (!input) return defaultTracer();
  const source = Array.isArray(input.profiles) ? input : migrateTracer(input);
  const unknown = Object.keys(source).find((key) => key !== "profiles");
  if (unknown) throw new Error(`След пули содержит лишнее поле: ${unknown}`);
  if (!source.profiles.length)
    throw new Error("Список трассеров пуст: нужен хотя бы один.");
  if (source.profiles.length > TRACER_PROFILE_LIMIT)
    throw new Error(`Трассеров не больше ${TRACER_PROFILE_LIMIT}.`);
  const profiles = source.profiles.map(parseTracerProfile);
  const ids = new Set();
  const owners = new Map();
  let everything = null;
  for (const profile of profiles) {
    if (ids.has(profile.id))
      throw new Error(`Трассеры повторяют идентификатор «${profile.id}».`);
    ids.add(profile.id);
    /* «Всё оружие» — не больше чем у одного: двое «на всё» спорили бы за
       каждый ствол, и в игре победил бы случайный. */
    if (profile.mode === "all") {
      if (everything)
        throw new Error("«Всё оружие» может быть только у одного трассера.");
      everything = profile;
      continue;
    }
    for (const weapon of profile.weapons) {
      const owner = owners.get(weapon);
      if (owner) throw new Error(`${weapon} выбран сразу у двух трассеров.`);
      owners.set(weapon, profile.id);
    }
  }
  return { profiles };
}

/*
 * Попадания первой схемы → вторая.
 *
 * Шесть зон сводятся к двум: голова остаётся головой, тело берёт настройки
 * корпуса, а если корпус не правили — первой включённой зоны тела. Нарисованные
 * виды брызг стали штатной кровью того же цвета; «искры» и «пыль» — штатными
 * искрами и дымом игры; «свой рисунок» — картинкой человека. Размер стал силой.
 */
const V1_BODY_ZONES = ["torso", "throat", "arms", "legs", "extremities"];
const V1_TEMPLATE_BY_STYLE = Object.freeze({
  sparks: "sparks",
  smoke: "smoke",
});

function migrateZone(id, zone) {
  if (!zone || typeof zone !== "object") return undefined;
  const style = String(zone.style || "");
  const amount = Number.isFinite(Number(zone.size)) ? Number(zone.size) : 0.5;
  const shared = {
    enabled: zone.enabled === true,
    ...(zone.colour ? { colour: zone.colour } : {}),
    amount: Math.min(1, Math.max(0, amount)),
  };
  if (style === "custom")
    return { ...shared, kind: "custom", picture: "upload" };
  if (V1_TEMPLATE_BY_STYLE[style])
    return {
      ...shared,
      kind: "template",
      template: V1_TEMPLATE_BY_STYLE[style],
      tinted: true,
    };
  return { ...shared, kind: "blood" };
}

const V1_ZONE_FIELDS = ["style", "deepColour", "size", "probability"];

function looksLikeFirstSchema(impact) {
  return Object.entries(impact?.zones || {}).some(
    ([id, zone]) =>
      !zoneIds.includes(id) ||
      (zone &&
        typeof zone === "object" &&
        V1_ZONE_FIELDS.some((field) => field in zone)),
  );
}

function migrateImpact(input) {
  if (!input || typeof input !== "object") return input;
  const zones =
    input.zones && typeof input.zones === "object" ? input.zones : {};
  const bodySource =
    V1_BODY_ZONES.map((id) => zones[id]).find((zone) => zone?.enabled) ||
    zones.torso;
  return {
    ...input,
    zones: {
      head: migrateZone("head", zones.head),
      body: migrateZone("body", bodySource),
    },
  };
}

function parseImpact(input) {
  const base = defaultImpact();
  if (!input) return base;
  const states = input.states
    ? names(input.states, stateIds, "Состояние цели")
    : base.states;
  const weaponGroups = input.weaponGroups
    ? names(input.weaponGroups, groupIds, "Группа оружия")
    : base.weaponGroups;
  const zones = {};
  for (const id of zoneIds) zones[id] = parseImpactZone(id, input.zones?.[id]);
  const unknownZone = Object.keys(input.zones || {}).find(
    (key) => !zoneIds.includes(key),
  );
  if (unknownZone)
    throw new Error(`Неизвестная зона попадания: ${unknownZone}`);
  const enabled = input.enabled === true;
  if (enabled && !states.length) {
    throw new Error("Выберите хотя бы одно состояние цели.");
  }
  if (enabled && !weaponGroups.length) {
    throw new Error("Выберите хотя бы одну группу оружия.");
  }
  /* «Убрать совсем» (ТЗ 17.10.2026, вечер): поле есть только у включённого —
     без смены схемы канонический вид прежних работ остаётся прежним. */
  return {
    enabled,
    states,
    weaponGroups,
    zones,
    ...(input.removeAll === true ? { removeAll: true } : {}),
  };
}

/**
 * Попадания, как они уйдут в игру. «Убрать совсем» — обе зоны включены и без
 * слоёв (то же, что плитка «Без эффекта»): кровь, искры и частицы выстрела
 * по игроку не рисуются ни у головы, ни у тела. Слои работы при этом лежат
 * нетронутыми и вернутся, когда выключатель снимут.
 */
export function effectiveImpact(impact) {
  if (impact?.removeAll !== true) return impact;
  return {
    ...impact,
    enabled: true,
    zones: Object.fromEntries(
      zoneIds.map((id) => [id, { ...impact.zones[id], enabled: true, layers: [] }]),
    ),
  };
}

/** Разбирает проект из хранилища, пресета или кода обмена. */
export function parseProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Проект эффектов обязателен.");
  }
  if (input.schema !== undefined && !READABLE_SCHEMAS.includes(input.schema)) {
    throw new Error(
      `Проект собран другой версией мастерской: ${input.schema}.`,
    );
  }
  /* Схема не названа — смотрим на сами зоны: до второй схемы поле писалось
     не всегда, а заготовки новой схемы его тоже не обязаны нести. */
  const legacy =
    input.schema === 1 ||
    (input.schema === undefined && looksLikeFirstSchema(input.impact));
  const unknown = Object.keys(input).find(
    (key) =>
      !["schema", "name", "tracer", "impact", "environment", "muzzle"].includes(
        key,
      ),
  );
  if (unknown) throw new Error(`Проект содержит лишнее поле: ${unknown}`);
  return {
    schema: PTFX_PROJECT_SCHEMA,
    name: boundedText(input.name, "Мои эффекты", 80),
    tracer: parseTracer(input.tracer),
    impact: parseImpact(legacy ? migrateImpact(input.impact) : input.impact),
    /* Старые пресеты и черновики раздела не знают — для них он штатный; а
       четыре семейства первой схемы раскладываются по нынешним. */
    environment: parseEnvironment(
      legacy ? migrateEnvironment(input.environment) : input.environment,
    ),
    /* Вспышки выстрела — раздел без смены схемы: у прежних проектов его нет,
       и без своих вспышек канонический вид прежний. */
    muzzle: parseMuzzle(input.muzzle),
  };
}

/** Канонический вид для хранения и сравнения. */
export function serializeProject(project) {
  const parsed = parseProject(project);
  return {
    schema: parsed.schema,
    name: parsed.name,
    tracer: {
      profiles: parsed.tracer.profiles.map((profile) => ({
        ...profile,
        colours: [...profile.colours],
        weapons: [...profile.weapons],
      })),
    },
    impact: {
      enabled: parsed.impact.enabled,
      ...(parsed.impact.removeAll === true ? { removeAll: true } : {}),
      states: [...parsed.impact.states],
      weaponGroups: [...parsed.impact.weaponGroups],
      zones: Object.fromEntries(
        zoneIds.map((id) => [
          id,
          {
            enabled: parsed.impact.zones[id].enabled,
            /* Слои копируются поимённо, а не ссылкой: канонический вид не
               должен делить массивы с разобранным проектом — правка одного
               меняла бы второй. */
            layers: parsed.impact.zones[id].layers.map((layer) => ({
              ...layer,
              motion: { ...layer.motion },
              direction: { ...layer.direction },
            })),
            distance: { ...parsed.impact.zones[id].distance },
          },
        ]),
      ),
    },
    environment: Object.fromEntries(
      ENVIRONMENT_FAMILY_IDS.map((id) => [id, { ...parsed.environment[id] }]),
    ),
    ...(serializeMuzzle(parsed.muzzle)
      ? { muzzle: serializeMuzzle(parsed.muzzle) }
      : {}),
  };
}

/** Что именно поменяет установка. */
export function projectStats(project) {
  const parsed = parseProject(project);
  const impact = effectiveImpact(parsed.impact);
  /* Включённая штатная кровь в игре ничего не меняет — в счёт не идёт. */
  const zones = zoneIds.filter((id) => impactZoneChanged(impact.zones[id]));
  const assignments = tracerAssignments(parsed.tracer);
  const weapons = assignments.reduce(
    (total, item) => total + item.weapons.length,
    0,
  );
  const families = changedFamilies(parsed.environment);
  return {
    muzzleWeapons: muzzleWeaponCount(parsed.muzzle),
    tracerEnabled: assignments.length > 0,
    tracerProfiles: assignments.length,
    tracerWeapons: weapons,
    /* Из них — стволы «Без трассера»: след у них убирается, а не рисуется. */
    tracerOffWeapons: assignments
      .filter((item) => item.profile.off === true)
      .reduce((total, item) => total + item.weapons.length, 0),
    impactEnabled: impact.enabled,
    /* Все эффекты попаданий убраны («Убрать совсем») — отдельно от «без эффекта» у зоны. */
    impactRemoved: impact.removeAll === true,
    zones,
    zoneCount: impact.enabled ? zones.length : 0,
    families,
    changed:
      weapons > 0 ||
      muzzleWeaponCount(parsed.muzzle) > 0 ||
      (impact.enabled && zones.length > 0) ||
      families.length > 0,
  };
}

/** Всё оружие, на которое ляжет хоть какой-то трассер. */
export function tracerWeapons(project) {
  const parsed = parseProject(project);
  return tracerAssignments(parsed.tracer).flatMap((item) => item.weapons);
}
