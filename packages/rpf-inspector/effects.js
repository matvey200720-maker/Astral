/*
 * Эффекты и трассеры из чужого редукса — что именно поменял автор.
 *
 * Эффекты GTA V живут в трёх местах, и в каждом своя правда.
 *
 *  • `core.ypt` — картинки и правила частиц: след пули, брызги крови,
 *    вспышка выстрела. Что автор перерисовал, видно по байтам текстур против
 *    ядра чистой игры, а не по хэшу файла: ядро, собранное под другую сборку,
 *    отличается целиком, хотя перерисована в нём дюжина картинок. Отдельно
 *    от рисунков идут пустышки — штатные текстуры, сжатые до пары точек ради
 *    FPS: это облегчение, а не эффект.
 *  • `weapons.meta` — у какого ствола какой след и как часто он виден
 *    (`<TracerFx>`, `TracerFxChanceSP/MP`). У редукса этот файл почти всегда
 *    отличается от игры уже потому, что он из другой сборки, поэтому
 *    сравниваются сами привязки, а не файл.
 *  • `bloodfx.dat` — какой эффект попадания у какой кости от какого класса
 *    оружия. Целым файлом он не ставится, поэтому разбор переводит правку
 *    автора в `blood-routing-v1` — те записи и маршруты, что меняют картинку,
 *    — и проверяет, что правка на файле игры даёт то же, что файл автора.
 *
 * Здесь только разбор — чистые функции над уже прочитанными данными. Чтение
 * архивов и запись DDS делает сборщик заявки на рабочем столе.
 */

import {
  BLOODFX_FIELD,
  BLOODFX_RECORD_FIELDS,
  BLOODFX_RECORD_SECTIONS,
  BLOODFX_TABLES,
  BLOOD_BODY_PARTS,
  BLOOD_WEAPON_CLASSES,
  BLOOD_WEAPON_GROUPS,
  applyBloodRouting,
  normalizeBloodRouting,
  parseBloodFx,
  referencedEffectRules,
  tableRow,
} from "@modovik/bloodfx";

/** Группы текстур ядра — по имени, в порядке показа. */
export const EFFECT_TEXTURE_KINDS = Object.freeze([
  Object.freeze({ id: "tracer", label: "Трассеры", test: /trac|tacer/i }),
  Object.freeze({ id: "blood", label: "Кровь", test: /blood|gore|wound/i }),
  Object.freeze({
    id: "muzzle",
    label: "Вспышки выстрела",
    test: /muzzle|flash/i,
  }),
  Object.freeze({
    id: "impact",
    label: "Попадания",
    test: /impact|bullet|hole|spark|debris|ricochet|shell/i,
  }),
  Object.freeze({
    id: "smoke",
    label: "Дым",
    test: /smoke|dust|steam|mist|fog/i,
  }),
  Object.freeze({
    id: "fire",
    label: "Огонь и взрывы",
    test: /fire|flame|explo|burn|ember/i,
  }),
  Object.freeze({
    id: "water",
    label: "Вода",
    test: /water|splash|rain|drip|drop/i,
  }),
  Object.freeze({ id: "other", label: "Прочее", test: /(?:)/ }),
]);

const kindOrder = new Map(
  EFFECT_TEXTURE_KINDS.map((kind, index) => [kind.id, index]),
);

/** Группа текстуры по имени: `ptfx_bullet_tracer` — трассер. */
export function effectTextureKind(name) {
  const value = String(name || "");
  return EFFECT_TEXTURE_KINDS.find((kind) => kind.test.test(value)).id;
}

/** Подпись группы для человека. */
export const effectKindLabel = (id) =>
  EFFECT_TEXTURE_KINDS.find((kind) => kind.id === id)?.label || "Прочее";

/*
 * Пустышка — штатная текстура, которую автор сжал до нескольких точек, чтобы
 * эффект не рисовался. В редуксах так «оптимизируют» частицы: сотня текстур
 * ядра становится 4×4. Рисунка в ней нет, слоем эффекта она не публикуется.
 */
export const BLANK_TEXTURE_SIDE = 8;

const isBlanked = (texture, before) =>
  texture.width <= BLANK_TEXTURE_SIDE &&
  texture.height <= BLANK_TEXTURE_SIDE &&
  (before.width > texture.width || before.height > texture.height);

function samePayload(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  if (typeof Buffer !== "undefined") return Buffer.compare(left, right) === 0;
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index]) return false;
  return true;
}

/**
 * Какие текстуры ядра автор перерисовал, добавил или сжал в пустышку.
 *
 * `authorTextures` и `vanillaTextures` — вывод `readYptTextures`. Без ядра
 * чистой игры (`vanillaTextures === null`) сравнивать не с чем: тогда
 * возвращаются все текстуры автора с изменением `unknown`, и это честно
 * называется в заявке.
 *
 * Перерисованная текстура (`changed`) ставится слоем поверх ядра Astral: у
 * неё есть штатное имя, на которое уже ссылаются правила частиц. Новая
 * (`added`) слоем не ставится — в ядре нет правила, которое её рисует.
 * Пустышка (`blanked`) — не рисунок, а выключенный эффект.
 */
export function diffCoreTextures(authorTextures, vanillaTextures) {
  const known = Array.isArray(vanillaTextures);
  const base = new Map(
    (vanillaTextures || []).map((texture) => [
      String(texture.name).toLowerCase(),
      texture,
    ]),
  );
  const changes = [];
  for (const texture of authorTextures || []) {
    const before = base.get(String(texture.name).toLowerCase()) || null;
    const same =
      before &&
      before.width === texture.width &&
      before.height === texture.height &&
      before.format === texture.format &&
      before.levels === texture.levels &&
      samePayload(before.payload, texture.payload);
    if (known && same) continue;
    changes.push({
      name: texture.name,
      kind: effectTextureKind(texture.name),
      change: !known
        ? "unknown"
        : !before
          ? "added"
          : isBlanked(texture, before)
            ? "blanked"
            : "changed",
      width: texture.width,
      height: texture.height,
      format: texture.format,
      levels: texture.levels,
      decodable: Boolean(texture.decodable && texture.payload),
      base: before
        ? {
            width: before.width,
            height: before.height,
            format: before.format,
            levels: before.levels,
          }
        : null,
    });
  }
  return changes.sort(
    (left, right) =>
      kindOrder.get(left.kind) - kindOrder.get(right.kind) ||
      left.name.localeCompare(right.name),
  );
}

const chance = (chunk, field) => {
  const match = new RegExp(`<${field}\\s+value="([^"]*)"`).exec(chunk);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : 0;
};

/**
 * Привязки трассеров из weapons.meta: какой след у ствола и как часто.
 *
 * Разбор по тексту, а не XML-деревом: файл весит мегабайт, в нём сотни
 * `CWeaponInfo`, а нужны пять полей. Блок ствола — от его `<Item
 * type="CWeaponInfo">` до следующего: вложенные `<Item>` внутри (точки
 * крепления, компоненты) нужных полей не содержат, а `</Item>` у них свои.
 */
export function readWeaponTracerBindings(xml) {
  const text = String(xml || "");
  const starts = [...text.matchAll(/<Item\s+type="CWeaponInfo"\s*>/g)].map(
    (match) => match.index,
  );
  const bindings = new Map();
  starts.forEach((start, index) => {
    const chunk = text.slice(start, starts[index + 1] ?? text.length);
    const name = /<Name>\s*([^<\s]+)\s*<\/Name>/.exec(chunk)?.[1];
    if (!name) return;
    const weapon = name.toUpperCase();
    bindings.set(weapon, {
      weapon,
      model: (
        /<Model>\s*([^<\s]*)\s*<\/Model>/.exec(chunk)?.[1] || ""
      ).toLowerCase(),
      tracerFx: /<TracerFx>\s*([^<\s]*)\s*<\/TracerFx>/.exec(chunk)?.[1] || "",
      chanceSP: chance(chunk, "TracerFxChanceSP"),
      chanceMP: chance(chunk, "TracerFxChanceMP"),
    });
  });
  return bindings;
}

/** Ствол в руках игрока, а не пулемёт техники: `WEAPON_*`, не `VEHICLE_WEAPON_*`. */
export const isHandWeapon = (name) => /^WEAPON_/i.test(String(name || ""));

/** Виден ли трассер у ствола: есть правило следа и ненулевой шанс. */
export const tracerVisible = (binding) =>
  Boolean(binding?.tracerFx) &&
  (Number(binding.chanceSP) > 0 || Number(binding.chanceMP) > 0);

/**
 * Привязки автора против игры.
 *
 * `changed` — автор тронул именно след этого ствола: правило или шанс. Без
 * weapons.meta игры (`vanilla === null`) сравнивать не с чем, и `changed`
 * остаётся ложным: выдумывать правку нельзя.
 */
export function diffTracerBindings(author, vanilla) {
  const rows = [];
  for (const [weapon, binding] of author || new Map()) {
    const before = vanilla?.get(weapon) || null;
    const changed = vanilla
      ? !before ||
        before.tracerFx !== binding.tracerFx ||
        before.chanceSP !== binding.chanceSP ||
        before.chanceMP !== binding.chanceMP
      : false;
    rows.push({ ...binding, before, changed });
  }
  return rows.sort((left, right) => left.weapon.localeCompare(right.weapon));
}

/** Классы оружия bloodfx.dat словами. */
export const BLOOD_CLASS_LABELS = Object.freeze({
  PUNCH_KICK: "Кулаки",
  MELEE_WOOD: "Дерево",
  MELEE_METAL: "Металл",
  MELEE_SHARP: "Клинки",
  MELEE_GENERIC: "Холодное",
  PISTOL_SMALL: "Лёгкие пистолеты",
  PISTOL_LARGE: "Тяжёлые пистолеты",
  PISTOL_SILENCED: "Пистолеты с глушителем",
  RUBBER: "Резиновые пули",
  SMG: "Пистолеты-пулемёты",
  SHOTGUN: "Дробовики",
  RIFLE_ASSAULT: "Штурмовые винтовки",
  RIFLE_SNIPER: "Снайперские винтовки",
  ROCKET: "Ракеты",
  GRENADE: "Гранаты",
  MOLOTOV: "Коктейли Молотова",
  FIRE: "Огонь",
  EXPLOSION: "Взрывы",
  LASER: "Лазер",
  STUNGUN: "Тазер",
  HEAVY_MG: "Пулемёты",
  VEHICLE_MG: "Пулемёты техники",
  CLOWN: "Клоунское",
  ALIEN: "Инопланетное",
  SKELETON: "Скелет",
});

/* Поля записи, которые `blood-routing-v1` умеет менять, — в имени правки. */
const NAME_KEYS = new Map([
  [BLOODFX_FIELD.fxSystem, "fxSystem"],
  [BLOODFX_FIELD.fxSystemBodyArmour, "fxSystemBodyArmour"],
  [BLOODFX_FIELD.fxSystemHeavyArmour, "fxSystemHeavyArmour"],
  [BLOODFX_FIELD.fxSystemUnderwater, "fxSystemUnderwater"],
]);
const TINT_FIELDS = Object.freeze([
  BLOODFX_FIELD.tintRed,
  BLOODFX_FIELD.tintGreen,
  BLOODFX_FIELD.tintBlue,
]);
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/* «0.50» и «0.5» — одно число: файлы разных сборок пишут их по-разному. */
const canonical = (value) =>
  NUMBER.test(value) ? String(Number(value)) : value;

const recordFields = (document, section, id) =>
  document.records?.[section]?.rows
    ?.get(id)
    ?.tokens.map((token) => token.text) || null;

/** Всё, что игра покажет по номеру записи: входное и выходное отверстие. */
const recordKey = (document, id) =>
  BLOODFX_RECORD_SECTIONS.map((section) => {
    const fields = recordFields(document, section.id, id);
    return fields ? fields.slice(1).map(canonical).join(" ") : "-";
  }).join("|");

const inRange = (value, min, max) =>
  NUMBER.test(value) && Number(value) >= min && Number(value) <= max;

/** Запись автора в форме правки: что выражается и сколько полей — нет. */
function recordEdit(section, id, after, before) {
  const edit = { section, id };
  let unsupported = 0;
  for (let index = 1; index < BLOODFX_RECORD_FIELDS; index += 1) {
    if (canonical(after[index]) === canonical(before[index])) continue;
    const name = NAME_KEYS.get(index);
    if (name) edit[name] = after[index];
    else if (TINT_FIELDS.includes(index)) {
      const tint = TINT_FIELDS.map((field) => Number(after[field]));
      if (
        tint.every(
          (value) => Number.isInteger(value) && value >= 0 && value <= 255,
        )
      )
        edit.tint = tint;
      else unsupported += 1;
    } else if (
      index === BLOODFX_FIELD.sizeEvolution &&
      inRange(after[index], 0, 25)
    )
      edit.sizeEvolution = Number(after[index]);
    else if (
      index === BLOODFX_FIELD.fxProbability &&
      inRange(after[index], 0, 1)
    )
      edit.probability = Number(after[index]);
    else unsupported += 1;
  }
  return { edit: Object.keys(edit).length > 2 ? edit : null, unsupported };
}

const groupOfClass = new Map(
  BLOOD_WEAPON_GROUPS.flatMap((group) =>
    group.classes.map((weaponClass) => [weaponClass, group.id]),
  ),
);

/**
 * Правка bloodfx.dat автора в форме `blood-routing-v1`.
 *
 * Разбор идёт от картинки, а не от байтов файла:
 *
 *  • запись, которая есть и у игры, и у автора, даёт `effect` — правила
 *    частиц, тон, размер и вероятность, где они отличаются;
 *  • клетка «кость × класс», которую автор увёл на штатную запись, даёт
 *    `route`; увёл на свою новую запись — маршрут не нужен, если после
 *    правки штатная запись показывает ровно то же самое (так автор HLS завёл
 *    795 как копию 295 с купюрами), иначе клетка правкой не выражается;
 *  • правка накладывается на файл игры и сверяется с файлом автора по
 *    каждой клетке: `exact` — установка даст ровно то, что было у автора.
 *
 * `classes` — классы оружия, у которых эффект после правки виден хотя бы на
 * одной кости. `extra` — маршруты для остальных классов: человек может
 * назначить эффект ещё и им, и клетка такого класса поведёт на ту же запись,
 * что у соседа по группе оружия, а без соседа — у большинства.
 *
 * Без файла игры правки нет: возвращаются только правила автора.
 */
export function analyzeBloodRouting(authorText, vanillaText) {
  const author = parseBloodFx(authorText);
  const authorRules = referencedEffectRules(author);
  const empty = {
    compared: false,
    patch: null,
    exact: false,
    rules: authorRules,
    newRules: authorRules,
    classes: [],
    extra: {},
    effects: 0,
    routes: 0,
    unsupported: { fields: 0, routes: 0, cells: 0 },
    identical: false,
    error: null,
  };
  if (!vanillaText) return empty;
  const vanilla = parseBloodFx(vanillaText);
  const baseRules = new Set(referencedEffectRules(vanilla));

  const effects = [];
  const inexact = new Set();
  let unsupportedFields = 0;
  for (const section of BLOODFX_RECORD_SECTIONS)
    for (const [id, row] of author.records[section.id].rows) {
      const before = vanilla.records[section.id].rows.get(id);
      if (!before) continue;
      const { edit, unsupported } = recordEdit(
        section.id,
        id,
        row.tokens.map((token) => token.text),
        before.tokens.map((token) => token.text),
      );
      if (edit) effects.push(edit);
      if (unsupported) {
        unsupportedFields += unsupported;
        inexact.add(id);
      }
    }

  const routes = [];
  let droppedRoutes = 0;
  for (const table of BLOODFX_TABLES)
    for (const bodyPart of BLOOD_BODY_PARTS) {
      const after = tableRow(author, table.id, bodyPart) || [];
      const before = tableRow(vanilla, table.id, bodyPart) || [];
      const columns = Math.min(after.length, before.length);
      for (let column = 0; column < columns; column += 1) {
        if (after[column] === before[column]) continue;
        const entry = after[column];
        if (vanilla.records.entry.rows.has(entry)) {
          routes.push({
            table: table.id,
            bodyPart,
            weaponClass: BLOOD_WEAPON_CLASSES[column],
            entry,
          });
          continue;
        }
        if (
          !inexact.has(before[column]) &&
          recordKey(author, entry) === recordKey(author, before[column])
        )
          continue;
        droppedRoutes += 1;
      }
    }

  const patched = parseBloodFx(vanillaText);
  let patch = null;
  let error = null;
  let report = null;
  if (effects.length || routes.length) {
    try {
      patch = normalizeBloodRouting({ routes, effects });
      report = applyBloodRouting(patched, patch);
    } catch (reason) {
      error = String(reason?.message || reason);
      patch = null;
    }
  }

  /* Какие клетки после правки показывают не то, что игра, и не то, что
     автор. */
  const touched = new Map();
  const affected = new Map();
  let mismatches = 0;
  for (const table of BLOODFX_TABLES)
    for (const bodyPart of BLOOD_BODY_PARTS) {
      const base = tableRow(vanilla, table.id, bodyPart) || [];
      const now = patch ? tableRow(patched, table.id, bodyPart) || [] : base;
      const wanted = tableRow(author, table.id, bodyPart) || [];
      const cells = new Set();
      for (let column = 0; column < base.length; column += 1) {
        const shown = recordKey(patch ? patched : vanilla, now[column]);
        if (shown !== recordKey(vanilla, base[column])) {
          cells.add(column);
          const weaponClass = BLOOD_WEAPON_CLASSES[column];
          const parts = affected.get(weaponClass) || new Set();
          parts.add(bodyPart);
          affected.set(weaponClass, parts);
        }
        if (
          column < wanted.length &&
          shown !== recordKey(author, wanted[column])
        )
          mismatches += 1;
      }
      touched.set(`${table.id}/${bodyPart}`, { now, cells });
    }

  const extra = {};
  if (patch && affected.size)
    BLOOD_WEAPON_CLASSES.forEach((weaponClass, column) => {
      if (affected.has(weaponClass)) return;
      const added = [];
      for (const table of BLOODFX_TABLES)
        for (const bodyPart of BLOOD_BODY_PARTS) {
          const { now, cells } = touched.get(`${table.id}/${bodyPart}`);
          if (column >= now.length || !cells.size) continue;
          const sibling = [...cells].find(
            (index) =>
              groupOfClass.get(BLOOD_WEAPON_CLASSES[index]) ===
              groupOfClass.get(weaponClass),
          );
          const counts = new Map();
          for (const index of cells)
            counts.set(now[index], (counts.get(now[index]) || 0) + 1);
          const common = [...counts.entries()].sort(
            (left, right) => right[1] - left[1],
          )[0][0];
          const entry = sibling === undefined ? common : now[sibling];
          if (entry !== now[column])
            added.push({ table: table.id, bodyPart, weaponClass, entry });
        }
      if (added.length) extra[weaponClass] = added;
    });

  /* Правила частиц — по тому, сколько полей записей на них ведёт. */
  const use = new Map();
  for (const edit of patch?.effects || [])
    for (const key of NAME_KEYS.values())
      if (edit[key] && edit[key] !== "-")
        use.set(edit[key], (use.get(edit[key]) || 0) + 1);
  const rules = (report?.requiredEffectRules || []).sort(
    (left, right) =>
      (use.get(right) || 0) - (use.get(left) || 0) || left.localeCompare(right),
  );

  return {
    compared: true,
    patch: patch
      ? {
          strategy: patch.strategy,
          routes: patch.routes,
          effects: patch.effects,
        }
      : null,
    exact:
      Boolean(patch) &&
      mismatches === 0 &&
      unsupportedFields === 0 &&
      droppedRoutes === 0,
    rules,
    newRules: authorRules.filter((rule) => !baseRules.has(rule)),
    classes: BLOOD_WEAPON_CLASSES.filter((item) => affected.has(item)).map(
      (weaponClass) => ({
        weaponClass,
        label: BLOOD_CLASS_LABELS[weaponClass] || weaponClass,
        parts: affected.get(weaponClass).size,
      }),
    ),
    extra,
    effects: effects.length,
    routes: routes.length,
    unsupported: {
      fields: unsupportedFields,
      routes: droppedRoutes,
      cells: patch ? mismatches : 0,
    },
    identical:
      !effects.length && !routes.length && !droppedRoutes && !unsupportedFields,
    error,
  };
}

export const BLOODFX_ENTRY = "common/data/effects/bloodfx.dat";
export const BLOOD_ROUTING_PAYLOAD = "payload/bloodfx-routing.json";

/**
 * Пакет слоя крови: правка `analyzeBloodRouting` накладывается на bloodfx.dat
 * игрока (`blood-routing-v1`), файл игры целиком не заменяется. Общий для
 * окна (`effects-request.js`) и разбора очереди (`intake-worker.js`).
 */
export function bloodRoutingSpec({ id, version = "1.0.0", author = "" }) {
  return {
    id,
    version,
    adapter: "rpf-entry",
    editions: ["Legacy"],
    requiresLoader: false,
    scope: "game-root",
    ...(author ? { author } : {}),
    capabilities: ["blood-routing-v1", "direct-update-entries-v1"],
    files: [
      {
        source: BLOOD_ROUTING_PAYLOAD,
        target: "update/update.rpf",
        entry: BLOODFX_ENTRY,
        action: "replace",
        merge: { strategy: "blood-routing-v1" },
      },
    ],
  };
}

