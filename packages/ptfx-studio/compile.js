/*
 * Проект мастерской → правки для игры.
 *
 * Здесь встречаются три вещи, которые в GTA лежат в разных файлах и связаны
 * только именами:
 *
 *   bloodfx.dat  говорит, какая запись отвечает за «голова × винтовка»;
 *   запись       называет правило эффекта;
 *   core.ypt     хранит правило и его текстуру.
 *
 * Astral не выдумывает новые записи и не переписывает чужой bloodfx.dat
 * целиком: записей в файле игры шестьдесят три при потолке движка в
 * шестьдесят четыре, и добавлять свои некуда. Он берёт записи, к которым база
 * игрока УЖЕ ведёт выбранную зону, и переставляет у них имя правила на своё
 * зарезервированное. Поэтому голова и тело разъезжаются ровно настолько,
 * насколько их разводит сам файл игрока, а всё, что не выбрано, остаётся как
 * было.
 *
 * И поэтому же компилятор обязан честно сказать две вещи:
 *   • conflict — две выбранные зоны ведут к одной записи, разного эффекта у
 *     них не будет (спорные клетки переставляются на свою запись зоны);
 *   • spill    — запись зоны используется ещё и там, куда игрок не смотрел,
 *     значит эффект появится и там.
 * Молчать про это нельзя: человек увидит результат в игре и решит, что мод
 * сломан.
 *
 * Само правило эффекта — составной клон штатных правил ядра игрока
 * (`impact.js`): у зоны слои, у каждого слоя свой донор (кровь клонируется с
 * крови, вода — со всплеска, картинка — с одноразового спрайта), а в ядре
 * стоит одно правило со всеми их эмиттерами. Клон строит помощник RPF при
 * установке; здесь — только рецепт.
 */

import {
  BLOOD_WEAPON_GROUPS,
  BLOOD_WEAPON_CLASSES,
  BLOOD_ZONES,
  BLOODFX_EMPTY_NAME,
  BLOODFX_FIELD,
  irregularRecords,
  weaponClassIndex,
} from "@modovik/bloodfx";
import {
  ASTRAL_IMPACT_SLOTS,
  ASTRAL_PTFX_CORE_CHANNEL,
  ASTRAL_PTFX_CORE_VERSION,
  ASTRAL_TRACER_SLOTS,
  ASTRAL_TRACER_TEXTURE_LAYOUT,
  tracerNearHide,
  tracerShape,
  tracerWeaponSource,
} from "@modovik/tracer-contract";
import { encodeDds, resample } from "@modovik/dds";
import {
  MUZZLE_SPEED_PROP,
  effectiveImpact,
  parseProject,
  tracerAssignments,
} from "./project.js";
import { environmentPlan } from "./environment.js";
import { findMuzzleShape, findShellKind, quietWeapons } from "./muzzle.js";
import {
  ASTRAL_BLOOD_SPRAY_TEXTURE,
  BLOOD_SHEET_GRID,
  BLOOD_SHEET_LAYOUT,
  BLOOD_SPRAY_TEXTURE,
  CUSTOM_TEXTURE_LAYOUT,
  IMPACT_EMITTER_CAP,
  IMPACT_PLACEMENTS,
  IMPACT_ZONES,
  bloodDecalTint,
  findBloodSheet,
  findImpactDonorFile,
  findImpactTemplate,
  impactAppearanceKey,
  impactCloneRecipe,
  impactZoneChanged,
  impactZoneEmitters,
  layerDonor,
  layerNeedsUpload,
  layerPictureKey,
  layerPlacement,
  placementLayers,
} from "./impact.js";
import { ruleParticlesDrawing } from "./rules.js";
import { bloodSheetKey, bloodSheetSvg } from "./sheets.js";
import { parseColour, renderTracerTexture } from "./shapes.js";

/** Классы оружия выбранных групп. */
export function selectedWeaponClasses(weaponGroups) {
  const classes = new Set();
  for (const group of BLOOD_WEAPON_GROUPS) {
    if (!weaponGroups.includes(group.id)) continue;
    for (const item of group.classes) classes.add(item);
  }
  return BLOOD_WEAPON_CLASSES.filter((item) => classes.has(item));
}

/** Все клетки таблиц, попадающие под выбор игрока. */
function selectedCells(document, states, classes) {
  const cells = [];
  for (const state of states) {
    const table = document.tables?.[state];
    if (!table) continue;
    for (const zone of BLOOD_ZONES) {
      for (const part of zone.parts) {
        const row = table.rows.get(part);
        if (!row) continue;
        for (const weaponClass of classes) {
          const entry = row.tokens[weaponClassIndex(weaponClass) + 1]?.text;
          if (!entry || entry === "0") continue;
          cells.push({ state, zone: zone.id, part, weaponClass, entry });
        }
      }
    }
  }
  return cells;
}

/** Записи, к которым не ведёт ни одна клетка ни одной таблицы. */
function spareEntries(document) {
  const used = new Set();
  for (const table of Object.values(document.tables || {})) {
    for (const row of table.rows.values()) {
      for (let index = 1; index < row.tokens.length; index += 1) {
        used.add(row.tokens[index].text);
      }
    }
  }
  return (document.records?.entry?.order || [])
    .filter((id) => !used.has(id))
    .sort((left, right) => Number(left) - Number(right));
}

/*
 * Кости вне выбранных зон. Их клетки правка не трогает, но запись, которой они
 * пользуются, общей с ними делать нельзя: в оригинале колонка дробовика ведёт
 * ВСЕ кости к одной записи, и «сердечки в голову» без этого вылезали бы при
 * каждом попадании дробью в ногу. Животные не в счёт: у них одна строка на всё
 * тело, и ради неё уводить корпус человека с его записи незачем.
 */
const OUTSIDE = "\u0000outside";
/* Запись не того вида (мод, другая версия игры, `irregularRecords`) Astral
   не правит: она «чужая» для всех групп, и клетки, которые к ней ведут,
   переезжают на свою запись группы, а сама запись остаётся как была. */
const IRREGULAR = "\u0000irregular";
const IGNORED_OUTSIDE_ZONES = Object.freeze(["animal"]);

/**
 * План маршрутизации: какая запись достанется какой группе зон.
 *
 * Группа — то, что обязано выглядеть одинаково: «голова» или «тело» целиком.
 * Внутри группы кости делят записи свободно — эффект у них один, — а вот
 * запись, к которой ведут клетки двух разных групп или костей невыбранной
 * зоны, спорная. Astral не сдаётся и не молчит: он переставляет только спорные
 * клетки на запись, которой группа владеет одна. Клетки, у которых запись и
 * так своя, остаются нетронутыми — вместе с оригинальными размерами и
 * декалями.
 *
 * Своя запись ищется в том же состоянии цели (живой, мёртвый, сетевая игра):
 * у записей мёртвого тела свои размеры ран и луж, и уводить их на запись
 * живого без нужды незачем.
 *
 * `groups` — `[{ id, label, zones: [id зоны bloodfx] }]` в порядке разбора:
 * кто раньше, тот первым выбирает свою запись.
 */
export function allocateGroupRouting(
  document,
  { states, weaponGroups, groups },
) {
  const classes = selectedWeaponClasses(weaponGroups);
  const groupOfZone = new Map();
  for (const group of groups)
    for (const zone of group.zones) groupOfZone.set(zone, group.id);
  const every = selectedCells(document, states, classes);
  const cells = every
    .filter((cell) => groupOfZone.has(cell.zone))
    .map((cell) => ({ ...cell, group: groupOfZone.get(cell.zone) }));

  const owners = new Map();
  for (const cell of every) {
    const owner =
      groupOfZone.get(cell.zone) ||
      (IGNORED_OUTSIDE_ZONES.includes(cell.zone) ? null : OUTSIDE);
    if (!owner) continue;
    const set = owners.get(cell.entry) || new Set();
    set.add(owner);
    owners.set(cell.entry, set);
  }
  for (const item of irregularRecords(document))
    if (item.section === "entry") owners.get(item.id)?.add(IRREGULAR);

  const canonical = new Map();
  /* Запись занята группой, а не состоянием: живой и сетевой живой в оригинале
     делят одни и те же записи, и группа вправе держать одну на оба. */
  const takenBy = new Map();
  const free = (entry, group) =>
    !takenBy.has(entry) || takenBy.get(entry) === group;
  const spare = spareEntries(document);
  const borrowed = [];
  for (const group of groups) {
    for (const state of states) {
      const own = cells.filter(
        (cell) => cell.group === group.id && cell.state === state,
      );
      /* Группа без единой клетки в этом состоянии (выбранное оружие её костей
         не касается) записи не требует: о ней скажет предупреждение `empty`. */
      if (!own.length) continue;
      /* Своя запись нужна, только если есть что на неё переставлять. */
      if (own.every((cell) => owners.get(cell.entry).size === 1)) continue;
      const mine = [...new Set(own.map((cell) => cell.entry))]
        .filter((entry) => free(entry, group.id))
        .map((entry) => ({
          entry,
          exclusive: owners.get(entry).size === 1,
          cells: own.filter((cell) => cell.entry === entry).length,
        }))
        // Своя запись лучше общей, а из своих — та, на которой больше клеток
        // группы: меньше перестановок, ближе к оригиналу.
        .sort(
          (left, right) =>
            Number(right.exclusive) - Number(left.exclusive) ||
            right.cells - left.cells ||
            Number(left.entry) - Number(right.entry),
        );
      let entry = mine.find((item) => item.exclusive)?.entry;
      if (!entry) {
        entry = spare.find((item) => free(item, group.id));
        if (entry && !takenBy.has(entry))
          borrowed.push({ group: group.id, state, entry });
      }
      if (!entry) {
        throw new Error(
          `Для зоны «${group.label}» в этом bloodfx.dat не осталось свободной записи: снимите одну из зон или расширьте выбор оружия.`,
        );
      }
      takenBy.set(entry, group.id);
      canonical.set(`${group.id}/${state}`, entry);
    }
  }

  /*
   * Клетка остаётся на своей записи, если этой записью не пользуется никто
   * другой: тогда у неё сохраняются оригинальные декали и размеры, подобранные
   * Rockstar под конкретный класс оружия. Спорные клетки переезжают на запись,
   * которой группа владеет одна.
   */
  const routes = [];
  const groupEntries = new Map(groups.map((group) => [group.id, new Set()]));
  for (const cell of cells) {
    if (owners.get(cell.entry).size === 1) {
      groupEntries.get(cell.group).add(cell.entry);
      continue;
    }
    const target = canonical.get(`${cell.group}/${cell.state}`);
    groupEntries.get(cell.group).add(target);
    routes.push({
      table: cell.state,
      bodyPart: cell.part,
      weaponClass: cell.weaponClass,
      entry: target,
    });
  }

  return {
    classes,
    canonical: Object.fromEntries(canonical),
    borrowed,
    routes,
    groupEntries: Object.fromEntries(
      [...groupEntries].map(([group, set]) => [
        group,
        [...set].sort((left, right) => Number(left) - Number(right)),
      ]),
    ),
  };
}

/**
 * Куда ещё дотянется правка.
 *
 * Запись группы может использоваться и там, куда игрок не смотрел: другим
 * классом оружия, другим состоянием цели или костью из невыбранной зоны. Мы
 * не переставляем эти клетки — они не наши, — но эффект там всё равно
 * поменяется, потому что имя правила живёт в самой записи. Про это надо
 * сказать словами до установки — и словами человека: «взрывное и огонь», а не
 * `ROCKET, GRENADE`.
 */
function impactSpill(document, impact, plan, groups) {
  const groupOfZone = new Map();
  for (const group of groups)
    for (const zone of group.zones) groupOfZone.set(zone, group.id);
  const owner = new Map();
  for (const [group, entries] of Object.entries(plan.groupEntries)) {
    for (const entry of entries) owner.set(entry, group);
  }
  const routed = new Set(
    plan.routes.map(
      (route) => `${route.table}/${route.bodyPart}/${route.weaponClass}`,
    ),
  );
  const weaponGroupOf = new Map();
  for (const group of BLOOD_WEAPON_GROUPS)
    for (const item of group.classes) weaponGroupOf.set(item, group.label);

  const extras = new Map();
  for (const [state, table] of Object.entries(document.tables || {})) {
    for (const zone of BLOOD_ZONES) {
      for (const part of zone.parts) {
        const row = table.rows.get(part);
        if (!row) continue;
        for (const weaponClass of BLOOD_WEAPON_CLASSES) {
          if (routed.has(`${state}/${part}/${weaponClass}`)) continue;
          const entry = row.tokens[weaponClassIndex(weaponClass) + 1]?.text;
          if (!entry || entry === "0") continue;
          const groupId = owner.get(entry);
          if (!groupId) continue;
          const sameGroup = groupOfZone.get(zone.id) === groupId;
          const selected =
            sameGroup &&
            impact.states.includes(state) &&
            plan.classes.includes(weaponClass);
          if (selected) continue;
          const extra = extras.get(groupId) || {
            weapons: new Set(),
            elsewhere: false,
            animals: false,
            states: false,
          };
          extras.set(groupId, extra);
          if (zone.id === "animal") {
            extra.animals = true;
            continue;
          }
          if (sameGroup && plan.classes.includes(weaponClass)) {
            extra.states = true;
            continue;
          }
          extra.weapons.add(
            (weaponGroupOf.get(weaponClass) || weaponClass).toLowerCase(),
          );
          if (!sameGroup) extra.elsewhere = true;
        }
      }
    }
  }
  return new Map(
    [...extras].map(([group, extra]) => {
      const parts = [];
      if (extra.weapons.size)
        parts.push(
          `от оружия «${[...extra.weapons].sort().join("», «")}»${
            extra.elsewhere ? " — по любой части тела" : ""
          }`,
        );
      if (extra.animals) parts.push("у животных");
      if (extra.states) parts.push("в невыбранных состояниях цели");
      return [group, parts.join(" и ")];
    }),
  );
}

/* Поля имён правила в записи входного отверстия, которые получают эффект
   зоны. Под водой штатная кровь — облачко в воде, и искры там ни к чему:
   подводное правило остаётся игровым, кроме зоны «без эффекта». */
const IMPACT_FX_FIELDS = Object.freeze([
  "fxSystem",
  "fxSystemBodyArmour",
  "fxSystemHeavyArmour",
]);

/**
 * Правка одной записи bloodfx под зону.
 *
 * Входная запись получает правило слоёв «спереди», выходная — «сзади»: так
 * клякса из паков Majestic вылетает из спины, а не из раны. Зона, у которой
 * спереди слоёв нет, а сзади есть, получает во входной записи прочерк —
 * иначе спереди играла бы штатная кровь, которую человек убрал.
 *
 * Слоёв сзади нет — у выходной записи имя меняется только там, где оно уже
 * стояло: у выходного отверстия частицы в оригинале есть только у
 * снайперских записей, и ставить туда эффект значило бы удвоить каждое
 * попадание.
 *
 * Пятна на стенах и земле остаются у зоны, в которой есть кровь, — тоном её
 * первого слоя крови. Искры и картинки без крови пятен не оставляют.
 */
function recordEffect({ document, section, id, settings, rules }) {
  const row = document.records?.[section]?.rows?.get(id);
  if (!row) return null;
  const layers = settings.layers || [];
  const none = layers.length === 0;
  const front = placementLayers(settings, "front").length > 0;
  const back = placementLayers(settings, "back").length > 0;
  const own = section === "exit" ? back : front;
  const name = own
    ? rules[section === "exit" ? "back" : "front"]
    : BLOODFX_EMPTY_NAME;
  const effect = { section, id };
  const fields = none
    ? [...IMPACT_FX_FIELDS, "fxSystemUnderwater"]
    : IMPACT_FX_FIELDS;
  for (const field of fields) {
    const current = row.tokens[BLOODFX_FIELD[field]]?.text;
    /* Выходная запись без своих слоёв: прочерк остаётся прочерком, а
       стоявшее имя (снайперские записи) получает правило «спереди». */
    if (section === "exit" && !back) {
      if (current === BLOODFX_EMPTY_NAME) continue;
      effect[field] = front ? rules.front : BLOODFX_EMPTY_NAME;
      continue;
    }
    /* Прочерк вместо прочерка — не правка. */
    if (!own && current === BLOODFX_EMPTY_NAME) continue;
    effect[field] = name;
  }
  const blood = layers.find((layer) => layer.kind === "blood");
  if (blood) effect.tint = bloodDecalTint(blood.colour);
  /* Искры и картинки крови на стенах не оставляют. */ else
    effect.decals = false;
  return Object.keys(effect).length > 2 ? effect : null;
}

/* Имя текстуры в ядре из отпечатка: только строчные буквы и цифры. */
const cleanKey = (key) =>
  String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16);

/**
 * Чужие словари, которые понадобятся проекту, — до сборки: установщик
 * достаёт их из игры вместе с ядром, потому что размеры листов для
 * перерисованных текстур лежат в них.
 */
export function projectDonorFiles(rawProject) {
  const parsed = parseProject(rawProject);
  const project = { ...parsed, impact: effectiveImpact(parsed.impact) };
  const files = new Map();
  if (!project.impact.enabled) return [];
  for (const zone of IMPACT_ZONES) {
    const settings = project.impact.zones[zone.id];
    if (!impactZoneChanged(settings)) continue;
    for (const layer of settings.layers) {
      const { effect, file } = layerDonor(zone.id, layer);
      if (!file) continue;
      const item = findImpactDonorFile(file);
      if (!item) throw new Error(`Неизвестный словарь доноров: ${file}`);
      if (!files.has(file)) files.set(file, { ...item, effects: new Set() });
      files.get(file).effects.add(effect);
    }
  }
  return [...files.values()]
    .map((file) => ({
      id: file.id,
      label: file.label,
      entry: file.entry,
      alternatives: file.alternatives || [],
      effects: [...file.effects].sort((left, right) =>
        left.localeCompare(right),
      ),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Разбирает проект, ничего не рисуя.
 *
 * Мастерская показывает разбор на каждое движение ползунка: какие записи
 * достанутся зонам, что переставится и куда правка дотянется сверх выбора.
 * Кодирование DDS для этого не нужно и стоило бы секунду на кадр, поэтому
 * план и сборка разведены.
 */
export function planProject({
  project: rawProject,
  bloodDocument,
  tracerLayout = ASTRAL_TRACER_TEXTURE_LAYOUT,
  /*
   * Картинки слоёв по ключу `зона:слой` (`layerPictureKey`): у каждой
   * `{ width, height, rgba, key?, dataUrl? }`. Байты, а не путь и не файл, —
   * потому что окно берёт их из canvas, а main-процесс из sharp, и разбирать
   * формат картинки здесь незачем. `key` — отпечаток картинки: два слоя с
   * одной и той же картинкой делят одну текстуру; `dataUrl` нужен листу
   * «своя картинка» — он ложится в SVG листа.
   */
  pictures = {},
  /*
   * Живая выписка правил ядра игрока (`readPtfxBase().impact.rules`): по
   * ней считаются эмиттеры сторон и частицы, рисующие лист. Без неё — по
   * запечённой выписке штатной игры.
   */
  rules = null,
}) {
  const parsed = parseProject(rawProject);
  /* «Убрать совсем» у попаданий — зоны включены и пусты, как «Без эффекта». */
  const project = { ...parsed, impact: effectiveImpact(parsed.impact) };
  const textures = [];
  const sheetTextures = [];
  const routes = [];
  const effects = [];
  const warnings = [];
  const clones = [];
  const sheets = [];
  const coreCopies = [];
  const assignments = { tracers: [], noTracer: [], zones: [] };

  /*
   * Трассеры: по слоту на каждый, в порядке списка. У слота своё правило
   * (размер и цвет — патчем) и своя текстура; оружие трассера привязывается
   * к его правилу. Трассер без оружия в игру не едет и слота не занимает.
   */
  const tracerRules = [];
  const bindings = [];
  /* Слот — только у трассера, который рисует след: «Без трассера» слота не
     занимает, ему нужна лишь привязка с пустым правилом. */
  let litTracers = 0;
  tracerAssignments(project.tracer).forEach(({ profile, weapons }) => {
    if (profile.off === true) {
      assignments.noTracer.push({ profile: profile.id, weapons: [...weapons] });
      for (const weapon of weapons)
        bindings.push({
          weapon,
          /* Пустой `<TracerFx />`, как у стволов, которым Rockstar следа не
             дала; шансы файла не трогаются — они при пустом следе ни на что
             не влияют, а снятие вернёт ствол целиком. */
          tracerFx: "",
          source: tracerWeaponSource(weapon),
        });
      return;
    }
    const slot = ASTRAL_TRACER_SLOTS[litTracers];
    litTracers += 1;
    if (!slot)
      throw new Error(
        `Трассеров больше, чем слотов в ядре (${ASTRAL_TRACER_SLOTS.length}).`,
      );
    /* Толщина и длина — размер спрайта в метрах, а не пиксели текстуры:
       их ставит патч правила слота, текстура несёт только облик и цвет. */
    const shape = tracerShape(profile);
    textures.push({
      kind: "tracer",
      slot: slot.id,
      rule: slot.rule,
      texture: slot.texture,
      layout: tracerLayout,
      render: {
        width: tracerLayout.width,
        height: tracerLayout.height,
        style: profile.style,
        colours: [...profile.colours],
        colourMode: profile.colourMode,
        coreColour: profile.coreColour,
        glow: profile.glow,
      },
    });
    /*
     * Цвет правила слота. Донор (`bullet_tracer`) красит спрайт кадрами
     * оранжевого (1; 0,6; 0,2), и текстура другого цвета под ними темнела бы:
     * синий след выходил грязно-зелёным. `neutralColour` — кадры цвета
     * белые, прозрачность и свечение прежние: цвет целиком из текстуры, во
     * всех режимах — и один цвет, и переход, и радуга живут в ней.
     */
    tracerRules.push({
      rule: slot.rule,
      ...shape,
      neutralColour: true,
      /* Только чужие выстрелы (задача 14 ТЗ 10.10.2026): след, прошедший у
         камеры (свой ствол), не рисуется — дальность LOD правила слота. */
      ...(profile.ownShots === "hide" ? { nearHide: { ...tracerNearHide(profile.ownShotsRadius) } } : {}),
    });
    assignments.tracers.push({
      profile: profile.id,
      slot: slot.id,
      rule: slot.rule,
      texture: slot.texture,
      weapons,
      shape,
      colourMode: profile.colourMode,
      colours: [...profile.colours],
    });
    for (const weapon of weapons) {
      const source = tracerWeaponSource(weapon);
      bindings.push({
        weapon,
        tracerFx: slot.rule,
        chanceSP: profile.chanceSP,
        chanceMP: profile.chanceMP,
        /* Где описан ствол: `weapons.meta` или файл пакета через dlc_patch. */
        source,
      });
    }
  });

  const activeZones = project.impact.enabled
    ? IMPACT_ZONES.filter((zone) =>
        impactZoneChanged(project.impact.zones[zone.id]),
      )
    : [];

  if (activeZones.length) {
    if (!bloodDocument) {
      throw new Error(
        "Эффекты попадания собираются только по базе bloodfx.dat игрока.",
      );
    }
    const pictureOf = (zoneId, index) =>
      pictures?.[layerPictureKey(zoneId, index)] || null;
    for (const zone of activeZones) {
      const settings = project.impact.zones[zone.id];
      settings.layers.forEach((layer, index) => {
        if (
          layerNeedsUpload(layer) &&
          !pictureOf(zone.id, index)?.rgba &&
          /* План в окне считается и до того, как картинка приехала: отказ —
             дело сборки, а разбор зон обязан показаться. */
          pictures?.required
        )
          throw new Error(
            `Для зоны «${zone.label}» (слой ${index + 1}) не выбрана картинка.`,
          );
      });
    }

    /*
     * Стопка обязана влезть в правило игры: у него не больше семи событий
     * (`IMPACT_EMITTER_CAP` — восьмое роняет игру на попадании), и считаются
     * они по донорам каждой стороны. Отказ — словами и до сборки.
     */
    for (const zone of activeZones) {
      const settings = project.impact.zones[zone.id];
      for (const placement of IMPACT_PLACEMENTS) {
        const emitters = impactZoneEmitters(
          zone.id,
          settings,
          placement.id,
          rules,
        );
        if (emitters > IMPACT_EMITTER_CAP)
          throw new Error(
            `Зона «${zone.label}» ${placement.label.toLowerCase()}: слои несут ${emitters} эмиттеров, а GTA играет у эффекта не больше ${IMPACT_EMITTER_CAP} — с большим числом игра вылетает при попадании. Уберите слой с этой стороны или выберите эффект полегче.`,
          );
      }
    }

    /*
     * Клон занимает облик, а не зона. Голова и тело с одинаковой стопкой
     * слоёв — это одно правило в ядре и одни текстуры, а не две одинаковых.
     * У зоны два облика — спереди и сзади: это две записи и два правила.
     */
    /* Отпечаток своей картинки слоя: другая картинка — другой облик. */
    const pictureKeys = (zoneId, settings) =>
      Object.fromEntries(
        settings.layers.map((layer, index) => [
          index,
          layerNeedsUpload(layer)
            ? String(
                pictureOf(zoneId, index)?.key || layerPictureKey(zoneId, index),
              )
            : "",
        ]),
      );
    const slotByAppearance = new Map();
    const sideKey = (zone, settings, placement) =>
      impactAppearanceKey(
        zone.id,
        settings,
        pictureKeys(zone.id, settings),
        placement,
      );
    for (const zone of activeZones) {
      const settings = project.impact.zones[zone.id];
      for (const placement of IMPACT_PLACEMENTS) {
        if (!placementLayers(settings, placement.id).length) continue;
        const key = sideKey(zone, settings, placement.id);
        if (slotByAppearance.has(key)) continue;
        if (slotByAppearance.size >= ASTRAL_IMPACT_SLOTS.length) {
          throw new Error(
            `Одновременно поддерживается не более ${ASTRAL_IMPACT_SLOTS.length} разных обликов эффекта попадания.`,
          );
        }
        slotByAppearance.set(key, ASTRAL_IMPACT_SLOTS[slotByAppearance.size]);
      }
    }

    const groups = activeZones.map((zone) => ({
      id: zone.id,
      label: zone.label,
      zones: [...zone.bloodZones],
    }));
    const plan = allocateGroupRouting(bloodDocument, {
      states: project.impact.states,
      weaponGroups: project.impact.weaponGroups,
      groups,
    });
    routes.push(...plan.routes);
    for (const item of plan.borrowed) {
      const zone = IMPACT_ZONES.find(
        (candidate) => candidate.id === item.group,
      );
      warnings.push({
        kind: "borrowed",
        zone: item.group,
        entry: item.entry,
        message: `Зоне «${zone.label}» досталась свободная запись ${item.entry}: в базе игры у неё не было собственной.`,
      });
    }
    const spills = impactSpill(bloodDocument, project.impact, plan, groups);

    /* Текстуры слоёв, уже заказанные: одна картинка — одна текстура. */
    const knownTextures = new Set();
    const built = new Set();
    /*
     * Текстуры слоёв. Картинка — своя текстура на отпечаток; лист брызг —
     * своя на стиль (и на картинку у стиля «своя»); штатный лист —
     * нейтральная копия листа игрока, общая для всех слоёв крови. У крови
     * без пыли (дымка) листа нет, и ей ничего не заказывается.
     */
    const layerTexture = (zone, settings, slot, layer, index) => {
      if (layer.kind === "custom") {
        const picture = pictureOf(zone.id, index);
        const key =
          layer.picture === "upload"
            ? cleanKey(picture?.key) || `${zone.id}${index}`
            : layer.picture;
        const texture = `astral_impact_pic_${key}`;
        if (knownTextures.has(texture)) return texture;
        knownTextures.add(texture);
        textures.push({
          kind: "impact",
          zone: zone.id,
          layer: index,
          slot: slot.id,
          rule: slot.rule,
          texture,
          layout: CUSTOM_TEXTURE_LAYOUT,
          picture:
            layer.picture === "upload"
              ? picture
              : { glyph: layer.picture, ...(picture || {}) },
        });
        sheets.push({ texture, columns: 1, rows: 1 });
        return texture;
      }
      if (layer.kind !== "blood") return null;
      const { effect } = layerDonor(zone.id, layer);
      if (!ruleParticlesDrawing(effect, BLOOD_SPRAY_TEXTURE, rules).length)
        return null;
      const style = findBloodSheet(layer.sheet);
      if (!style || style.game) {
        if (
          !coreCopies.some(
            (item) => item.texture === ASTRAL_BLOOD_SPRAY_TEXTURE,
          )
        ) {
          /* Нейтральная копия листа кровяной пыли — из ядра самого игрока:
             те же кадры и та же сетка, только без запечённого красного. */
          coreCopies.push({
            texture: ASTRAL_BLOOD_SPRAY_TEXTURE,
            source: BLOOD_SPRAY_TEXTURE,
            transform: "neutral",
          });
          sheets.push({
            texture: ASTRAL_BLOOD_SPRAY_TEXTURE,
            copyFrom: BLOOD_SPRAY_TEXTURE,
          });
        }
        return null;
      }
      const picture = style.upload ? pictureOf(zone.id, index) : null;
      const texture = `astral_impact_sheet_${bloodSheetKey(
        layer.sheet,
        picture?.key || `${zone.id}${index}`,
      )}`;
      if (knownTextures.has(texture)) return texture;
      knownTextures.add(texture);
      sheetTextures.push({
        kind: "sheet",
        zone: zone.id,
        layer: index,
        texture,
        style: layer.sheet,
        layout: BLOOD_SHEET_LAYOUT,
        grid: { ...BLOOD_SHEET_GRID },
        /* SVG собирается при сборке: у листа «своя картинка» он ждёт
           data-URL, которого в плане окна может ещё не быть. */
        svg: style.upload
          ? picture?.dataUrl
            ? bloodSheetSvg(layer.sheet, { upload: picture.dataUrl })
            : null
          : bloodSheetSvg(layer.sheet),
        picture,
      });
      sheets.push({
        texture,
        columns: BLOOD_SHEET_GRID.columns,
        rows: BLOOD_SHEET_GRID.rows,
      });
      return texture;
    };

    for (const zone of activeZones) {
      const settings = project.impact.zones[zone.id];
      const entries = plan.groupEntries[zone.id] || [];
      if (!entries.length) {
        warnings.push({
          kind: "empty",
          zone: zone.id,
          message: `Для зоны «${zone.label}» выбранные группы оружия не дают ни одной записи.`,
        });
        continue;
      }
      const spill = spills.get(zone.id);
      if (spill) {
        warnings.push({
          kind: "spill",
          zone: zone.id,
          message: `Эффект зоны «${zone.label}» появится ещё и там: ${spill}.`,
        });
      }
      for (const layer of settings.layers) {
        if (layer.kind !== "template") continue;
        const item = findImpactTemplate(layer.template);
        if (item.weight === "heavy")
          warnings.push({
            kind: "heavy",
            zone: zone.id,
            message: `«${item.label}» — тяжёлый эффект: в перестрелке таких вспышек десятки разом, на слабой видеокарте кадры просядут.`,
          });
      }

      /* Два правила зоны: спереди (входная запись) и сзади (выходная). */
      const sides = {};
      for (const placement of IMPACT_PLACEMENTS) {
        const own = placementLayers(settings, placement.id);
        if (!own.length) continue;
        const slot = slotByAppearance.get(
          sideKey(zone, settings, placement.id),
        );
        sides[placement.id] = slot;
        if (built.has(slot.rule)) continue;
        built.add(slot.rule);
        const layerTextures = {};
        for (const { layer, index } of own)
          layerTextures[index] = layerTexture(
            zone,
            settings,
            slot,
            layer,
            index,
          );
        const recipe = impactCloneRecipe(zone.id, settings, {
          rule: slot.rule,
          textures: layerTextures,
          placement: placement.id,
          rules,
        });
        clones.push({
          zone: zone.id,
          placement: placement.id,
          kinds: own.map(({ layer }) => layer.kind),
          ...recipe,
        });
      }

      const sideRules = {
        front: sides.front?.rule ?? null,
        back: sides.back?.rule ?? null,
      };
      for (const entry of entries) {
        for (const section of ["entry", "exit"]) {
          const effect = recordEffect({
            document: bloodDocument,
            section,
            id: entry,
            settings,
            rules: sideRules,
          });
          if (effect) effects.push(effect);
        }
      }
      const donorsOf = (rule) =>
        clones
          .find((item) => item.effect === rule)
          ?.layers.map((layer) => layer.donorEffect) || [];
      assignments.zones.push({
        zone: zone.id,
        kinds: settings.layers.map((layer) => layer.kind),
        placements: settings.layers.map(layerPlacement),
        layers: settings.layers.length,
        slot: sides.front?.id ?? null,
        rule: sideRules.front,
        backSlot: sides.back?.id ?? null,
        backRule: sideRules.back,
        donors: [...donorsOf(sideRules.front), ...donorsOf(sideRules.back)],
        entries,
      });
    }
  }

  /* Окружение правит штатные текстуры ядра по их же именам; пиксели для
     этого берутся из базы игрока уже при сборке патча, здесь — только план. */
  const environment = environmentPlan(project.environment);

  /*
   * Вспышки выстрела — рецепты клонов без донора: донор — тот `<FlashFx>`,
   * что стоит у ствола в игре, и узнаёт его установщик, прочитав файл оружия.
   * Цвет — тон и насыщенность при яркости донора, как у попаданий.
   */
  const particleTune = (item) => ({
    colour: parseColour(item.colour).map(
      (channel) => Math.round((channel / 255) * 1000) / 1000,
    ),
    colourMode: "recolour",
    ...(item.count !== 1 ? { spawnScale: item.count } : {}),
    ...(item.speed !== 1
      ? { scales: [{ prop: MUZZLE_SPEED_PROP, factor: item.speed }] }
      : {}),
  });
  /*
   * «Без вспышки и дыма» (задача 6 ТЗ 17.10.2026): у ствола пустые вспышка
   * и дым (и от первого лица) и выключенный свет вспышки. Тишина сильнее
   * своей вспышки и своего дыма: их клоны для такого ствола не строятся.
   */
  const quiet = quietWeapons(project.muzzle);
  const quietSet = new Set(quiet);
  const shellOf = new Map(
    (project.muzzle?.shells || []).map((item) => [item.weapon, item.shell]),
  );
  const smokeOf = new Map(
    (project.muzzle?.smokes || []).map((item) => [item.weapon, item]),
  );
  /*
   * Вид выстрела в файле оружия (`muzzle-look.js` установщика): размер и свет
   * вспышки, накопление дыма и гильзы. Свет без своего цвета — цвета самой
   * вспышки: бирюзовая вспышка освещает стену бирюзовым.
   */
  const lookOf = (weapon) => {
    const silent = quietSet.has(weapon);
    const flash = silent
      ? null
      : (project.muzzle?.flashes || []).find((item) => item.weapon === weapon);
    const smoke = silent ? null : smokeOf.get(weapon);
    const shell = shellOf.has(weapon)
      ? findShellKind(shellOf.get(weapon))
      : null;
    const look = {
      size: flash && flash.size !== 1 ? flash.size : null,
      light: silent
        ? { on: false }
        : flash
          ? {
              on: flash.light,
              rgb: parseColour(flash.lightColour || flash.colour),
              power: flash.lightPower,
              range: flash.lightRange,
            }
          : null,
      smokeBuild: smoke && smoke.build !== 1 ? smoke.build : null,
      shell: shell ? shell.rule : null,
    };
    return Object.values(look).some((value) => value !== null) ? look : null;
  };
  const muzzles = (project.muzzle?.flashes || [])
    .filter((flash) => !quietSet.has(flash.weapon))
    .map((flash) => ({
      weapon: flash.weapon,
      /* Форма — другая вспышка ядра; пусто — своя вспышка ствола. */
      ...(flash.shape
        ? { shape: flash.shape, shapeRule: findMuzzleShape(flash.shape).rule }
        : {}),
      tune: particleTune(flash),
    }));
  /* Дым — клон штатного дыма ствола; донора узнаёт установщик. */
  const smokes = (project.muzzle?.smokes || [])
    .filter((smoke) => !quietSet.has(smoke.weapon))
    .map((smoke) => ({
      weapon: smoke.weapon,
      tune: particleTune(smoke),
    }));
  const muzzleLooks = [
    ...new Set([
      ...(project.muzzle?.flashes || []).map((item) => item.weapon),
      ...(project.muzzle?.smokes || []).map((item) => item.weapon),
      ...(project.muzzle?.shells || []).map((item) => item.weapon),
      ...quiet,
    ]),
  ]
    .map((weapon) => ({ weapon, look: lookOf(weapon) }))
    .filter((item) => item.look);

  if (
    !textures.length &&
    !sheetTextures.length &&
    !environment.length &&
    !clones.length &&
    !effects.length &&
    !muzzles.length &&
    !smokes.length &&
    !muzzleLooks.length &&
    !quiet.length &&
    /* «Без трассера» — только привязки к стволам, ни текстуры, ни клона. */
    !bindings.length
  ) {
    throw new Error("В проекте эффектов нет изменений — устанавливать нечего.");
  }

  /* Доноры из ядра — и доноры из чужих словарей, по файлам. */
  const requiredDonors = [
    ...new Set(
      clones.flatMap((item) =>
        item.layers
          .filter((layer) => !layer.donorFile)
          .map((layer) => layer.donorEffect),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const donorFiles = new Map();
  for (const item of clones)
    for (const layer of item.layers) {
      if (!layer.donorFile) continue;
      const file = findImpactDonorFile(layer.donorFile);
      if (!file)
        throw new Error(`Неизвестный словарь доноров: ${layer.donorFile}`);
      if (!donorFiles.has(file.id))
        donorFiles.set(file.id, { ...file, effects: new Set() });
      donorFiles.get(file.id).effects.add(layer.donorEffect);
    }
  const requiredDonorFiles = [...donorFiles.values()]
    .map((file) => ({
      id: file.id,
      label: file.label,
      entry: file.entry,
      /* Тот же словарь в других вариантах качества — где его искать, если
         редукс переложил штатный архив (`IMPACT_DONOR_FILES`). */
      alternatives: file.alternatives || [],
      effects: [...file.effects].sort((left, right) =>
        left.localeCompare(right),
      ),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const tunes = clones.flatMap((item) =>
    item.layers.map((layer) => layer.tune),
  );

  return {
    project,
    textures,
    /* Листы брызг, которые растрирует установщик: SVG и раскладка. */
    sheetTextures,
    /* Составные клоны правил эффектов попадания — рецепты для помощника RPF.
       Семейство `astral_impact_*` пересобирается целиком при каждой установке. */
    clones,
    /* Текстуры-копии, которые собираются из ядра игрока при установке. */
    coreCopies,
    /* Сетки кадров новых текстур для ptxclipregions.dat. */
    sheets,
    environment,
    blood: effects.length || routes.length ? { routes, effects } : null,
    weaponBindings: bindings,
    /* Вспышки выстрела по стволам: клон снимается при установке. */
    muzzles,
    /* Дым из ствола по стволам — тоже клоны, с донором из файла оружия. */
    smokes,
    /* Размер и свет вспышки, накопление дыма и гильзы — поля файла оружия. */
    muzzleLooks,
    /* Стволы без вспышки и дыма: пустые `<FlashFx>`/`<MuzzleSmokeFx>`. */
    quiet,
    /* Размер и цвет спрайта следа для патча ядра: по правилу на трассер. */
    tracerRules,
    assignments,
    warnings,
    /* Штатные правила ядра, без которых клон не построить. */
    requiredDonors,
    /* Чужие словари с их правилами: установщик достаёт их из игры игрока. */
    requiredDonorFiles,
    /* Что нужно уметь помощнику RPF сверх старого заказа: слои, дальность,
       доноры из чужого словаря, режимы цвета, цвет правила следа. */
    helperFeatures: [
      ...(tracerRules.length ? ["tracer-rule-colour"] : []),
      /* `<FlashFx>` в файле оружия: прежний помощник его молча не тронул бы,
         и клон вспышки лёг бы в ядро без ствола. */
      ...(muzzles.length || smokes.length || muzzleLooks.length || quiet.length
        ? ["weapons-meta-flash"]
        : []),
      /* Свет, размер, дым и гильзы в файле оружия: прежний помощник их не
         знает и отказал бы на незнакомом поле привязки. */
      ...(smokes.length || muzzleLooks.length || quiet.length
        ? ["weapons-meta-muzzle-look"]
        : []),
      ...(clones.some((item) => item.layers.length > 1)
        ? ["effect-clone-layers"]
        : []),
      ...(clones.some((item) => item.lod) ? ["effect-clone-lod"] : []),
      ...(tracerRules.some((item) => item.nearHide) ? ["tracer-rule-near-hide"] : []),
      /* Один список эволюций на правило: прежний помощник оставлял слоям и
         достроенной дальности свои списки, и игра падала при попадании
         (24.09.2026). Одинокому донору без дальности сводить нечего. */
      ...(clones.some((item) => item.layers.length > 1 || item.lod)
        ? ["effect-clone-evolutions"]
        : []),
      ...(requiredDonorFiles.length ? ["effect-clone-donor-file"] : []),
      ...(tunes.some((tune) => ["duo", "rainbow"].includes(tune?.colourMode))
        ? ["effect-clone-colour-modes"]
        : []),
      ...(tunes.some((tune) => tune?.partColours?.length)
        ? ["effect-clone-part-colours"]
        : []),
      /* Масштаб правила целиком: без него значок жил бы 8 % своего размера,
         а старый помощник молча оставил бы донорский. */
      ...(tunes.some((tune) => tune?.effectZoom != null)
        ? ["effect-clone-effect-zoom"]
        : []),
      /* Подводный донор на суше: старый помощник молча оставил бы гашение над
         водой, и слой в игре не показался бы вовсе (пузырьки, 31.10.2026). */
      ...(tunes.some((tune) => tune?.openAir)
        ? ["effect-clone-open-air"]
        : []),
    ],
    requiredRules: [
      ...new Set(
        textures
          .filter((item) => item.kind === "tracer")
          .map((item) => item.rule),
      ),
    ].sort((left, right) => left.localeCompare(right)),
    /*
     * Обязательные плитки — только слоты самого Astral (след пули): их несёт
     * наше ядро, и без них ставить нечего. Листы окружения сюда не идут: это
     * штатные плитки игры, которые мы перекрашиваем, и урезанное чужое ядро
     * может не нести какую-то из них. Требовать их значило бы отказать в
     * перекраске всего огня из-за одной пропавшей свечи.
     */
    requiredTextures: [
      ...new Set(
        textures
          .filter((item) => item.kind === "tracer")
          .map((item) => item.texture),
      ),
    ].sort((left, right) => left.localeCompare(right)),
    environmentTextures: [
      ...new Set(environment.map((item) => item.texture)),
    ].sort((left, right) => left.localeCompare(right)),
    coreChannel: ASTRAL_PTFX_CORE_CHANNEL,
    coreVersion: ASTRAL_PTFX_CORE_VERSION,
  };
}

/**
 * Картинка слоя → RGBA листа из одного кадра.
 *
 * Картинка уже приведена к квадрату вызывающим (окно — холстом, установщик —
 * sharp); здесь она только доводится до размера текстуры слота.
 */
function renderPictureTexture(picture, layout) {
  if (!picture?.rgba)
    throw new Error("Для вида «Картинка» нужна сама картинка.");
  if (picture.width === layout.width && picture.height === layout.height)
    return picture.rgba;
  return resample(
    picture.rgba,
    picture.width,
    picture.height,
    layout.width,
    layout.height,
  );
}

/**
 * Собирает проект в то, что уходит установщику.
 *
 * К плану добавляются готовые DDS ровно того layout, которого требует слот в
 * ядре: приложение обязано отдать точный payload, а не «похожую картинку» —
 * патч текстуры сверяет ширину, высоту, формат и число mip и отказывается
 * работать при малейшем расхождении. Листы брызг остаются SVG: их растрирует
 * установщик (в окне план листов не нужен, а в главном процессе есть sharp).
 */
export function compileProject(input) {
  const plan = planProject({
    ...input,
    pictures: { ...(input.pictures || {}), required: true },
  });
  for (const sheet of plan.sheetTextures) {
    if (!sheet.svg)
      throw new Error(
        `Для листа брызг «своя картинка» (${sheet.zone}, слой ${sheet.layer + 1}) не выбрана картинка.`,
      );
  }
  return {
    ...plan,
    textures: plan.textures.map((texture) => ({
      ...texture,
      dds: encodeDds({
        width: texture.layout.width,
        height: texture.layout.height,
        format: texture.layout.format,
        mipLevels: texture.layout.mipLevels,
        rgba:
          texture.kind === "tracer"
            ? renderTracerTexture(texture.render)
            : renderPictureTexture(texture.picture, texture.layout),
      }),
    })),
  };
}
