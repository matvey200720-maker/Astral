import { readStoredJson, storedStateName } from "./stored-json.js";
import { tr } from "./locales/ui.js";
/*
 * Что из собранного в мастерской стоит в игре — и как это оттуда убрать.
 *
 * Карточка каталога знает об установке из списка установленных модов: мод
 * опубликован, у него есть id, id лежит в `installed`. У редакторов такого
 * id нет — их работа уезжает в игру патчем, а память о нём остаётся в
 * хранилище браузера: у неба, килл-эффекта и эффектов — записью
 * `useInstallRecord`, у арены — своей записью, у студии (прицел, мини-карта,
 * большая карта) — в проекте, рядом с работой человека. Плитка редактора,
 * которая говорит «не установлено», пока в игре стоит собранная в ней
 * мини-карта, врёт; здесь эти записи сводятся в один список.
 *
 * Единица списка — одна установка, то есть то, что снимается одним
 * действием: точка отката нативного хоста (`native`), мод движка (`mod`),
 * ресурс FiveM (`resource`). Плитки полки — производная: у одной установки
 * бывает несколько плиток. Патч эффектов несёт и трассеры, и попадания, и
 * огонь — и помечен `split: "effects"`: корзина библиотеки снимает с него
 * только отмеченные части, пересобирая набор без них
 * (`features/library/removal-request.js`), а не уносит все три. Так же
 * устроены звуки попадания (`split: "sound-hits"`): голова и тело — один
 * мод на двух карточках.
 *
 * Читается синхронно и без подписки: записи меняют сами редакторы, а они
 * занимают всю страницу каталога — к возвращению на полку она перерисуется.
 */

import {
  effectsTracerActive,
  readWorksStore,
} from "./features/workshop/works/workshop-works.js";
import { WORK_KINDS } from "./features/workshop/works/work-kinds.js";
import {
  SOUND_KIT_INSTALL_KEY,
  forgetSoundKitMods,
  soundKitUnits,
} from "./features/workshop/sound-kit-record.js";
import { OPTIMIZATION_RECORD_KEYS } from "@modovik/optimizer/layer-ids.js";
import {
  clothingPaintUnits,
  forgetClothingPaintMods,
} from "./features/workshop/install-queue/tasks/clothing-paint-slots.js";
import {
  isParkedUnit,
  readParkedInstalls,
} from "./features/library/parked-installs.js";
import {
  forgetWeaponSkinMods,
  weaponSkinUnits,
} from "./features/library/weapon-skin-items.js";

const PROJECTS_KEY = "astral-workshop-projects-v1";
const EFFECTS_RECORD_KEY = "astral.effects-studio.install.v1";
const EFFECTS_PROJECT_KEY = "astral.ptfx.project.v1";
export const APPLIED_OPTIMIZER_RECORD_KEY = "astral.optimizer.applied.v1";

/*
 * Мегамолл живёт мимо проекта студии: он открывается своей веткой
 * `WorkshopStudio`, а установки держит в ответе `getMegaMallCapabilities()`,
 * куда полка не ходит. Слепок активной установки редактор кладёт сюда —
 * иначе плитка показывала бы «не установлено» при живом overlay.
 */
export const MEGA_MALL_INSTALL_KEY = "astral.mega-mall.install.v1";

/* Слот → ключ записи `useInstallRecord` (или записи арены) в хранилище. */
const RECORD_KEYS = Object.freeze({
  timecycle: "astral.timecycle.install.v1",
  "kill-effects": "astral.kill-effect.install.v1",
  /* След на экране — нативный патч со своей точкой отката. */
  "screen-hits": "astral.screen-hits.install.v1",
  /* Метки и GPS — нативный патч со своей точкой отката. */
  blips: "astral.gps.install.v1",
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026) — нативный патч со своей точкой отката. */
  "target-hp": "astral.target-hp.install.v1",
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер) — нативный патч со своей точкой отката. */
  "group-markers": "astral.group-markers.install.v1",
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер) — нативный патч со своей точкой отката. */
  "wheel-smoke": "astral.wheel-smoke.install.v1",
  /* Арена — один мод слоя в своём контейнере (прежняя студия арены в игру
     не ставила, её ключа записи больше нет). */
  arenas: "astral.arenas.install.v1",
  /* Мегамолл — редактор здания из игры: один мод слоя в своём контейнере. */
  "mega-mall": "astral.megamall.install.v1",
  /* «Ашан / Икея» — второе здание из игры, тоже один мод слоя. */
  ashan: "astral.youtool.install.v1",
  /* «Вайнвуд» — надпись на холме, один мод слоя. */
  vinewood: "astral.vinewood.install.v1",
  /* «Остановки» — остановки всей карты, один мод слоя. */
  busstops: "astral.busstops.install.v1",
  /* Ключ — id плитки на полке («msl-zones», «float-logo», «capt-zones»), а не
     имя набора: под именем набора полка не находила установку, плитка
     показывала стандартную обложку без галочки (владелец, 11.10.2026). */
  "msl-zones": "astral.mslzones.install.v1",
  "float-logo": "astral.floatlogo.install.v1",
  /* Дирижабли (ТЗ 11.10.2026). */
  airships: "astral.airships.install.v1",
  shops: "astral.shops.install.v1",
  billboards: "astral.billboards.install.v1",
  "capt-zones": "astral.captzones.install.v1",
  schedule: "astral.schedule.install.v1",
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
  flags: "astral.flags.install.v1",
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
  atms: "astral.atms.install.v1",
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер). */
  projectinteriors: "astral.projectinteriors.install.v1",
  /* «Интерьеры Majestic RP» (25.10.2026): ключ — id плитки на полке, а не имя набора. */
  "majestic-interiors": "astral.majesticinteriors.install.v1",
  roads: "astral.roads.install.v1",
  /* Фонари: точка отката (файлы update.rpf) и мод слоя (модели) —
     `layerModId` в той же записи. */
  lights: "astral.lamp-studio.install.v1",
  /* Прострелы: один мод слоя (`layerModId`) в своём контейнере. */
  wallbang: "astral.wallbang.install.v1",
  /* «Животные» (05.11.2026): один мод слоя в своём контейнере. */
  animals: "astral.animals.install.v1",
  /* Наборы перекраски — тоже один мод слоя в своём контейнере. */
  "forbidden-zones": "astral.zones.install.v1",
  factory: "astral.factory.install.v1",
  hangar: "astral.hangar.install.v1",
  mapping: "astral.mapping.install.v1",
  /* Вода — один мод слоя: плитки тумана, квады и реки. */
  water: "astral.water.install.v1",
  /* Растительность — один мод слоя в своём контейнере. */
  vegetation: "astral.vegetation.install.v1",
  /* Шрифты — один мод слоя: библиотеки шрифтов на своих местах. */
  fonts: "astral.fonts.install.v1",
});

/*
 * Прежние записи на тех же плитках: overlay Мегамолла из старой студии
 * (`MegaMallCustomizer`) — установка, которую корзина обязана видеть и
 * снимать, хотя плитка теперь у нового редактора здания.
 */
const LEGACY_SLOT_RECORDS = Object.freeze([["mega-mall", MEGA_MALL_INSTALL_KEY]]);

/*
 * Записи, которые на полке плиток не имеют, но держат точку отката той же
 * стопки. Библиотека, переставив работы на место, переписывает имя точки и
 * у них: иначе «Откатить» в воде или оптимизации искала бы точку, которой
 * больше нет.
 */
const SHELFLESS_RECORD_KEYS = Object.freeze([
  "astral.water-studio.install.v1",
  "astral.vegetation-studio.install.v1",
  APPLIED_OPTIMIZER_RECORD_KEY,
  /* Слои оптимизации: мод слоя или набора без точки — снятый стирает запись. */
  ...OPTIMIZATION_RECORD_KEYS,
]);

/* Модуль студии → слоты каталога, на плитках которых его установка видна. */
const STUDIO_MODULE_SLOTS = Object.freeze({
  minimap: Object.freeze(["minimap", "minimap-zoom", "minimap-position"]),
  "world-map": Object.freeze(["large-map", "large-map-zoom"]),
  crosshair: Object.freeze(["crosshair"]),
  "sniper-scope": Object.freeze(["sniper-crosshair"]),
  /* Залазы ставятся из студии и запись в проекте оставляют
     (`onInstallationChange` прокинут в ClimbCustomizer) — не хватало только
     строки здесь, и плитка «Залазы» молчала об установке. */
  climbs: Object.freeze(["climbing"]),
});

/*
 * Вид установки студии → модули, которые она везёт в игру.
 *
 * Проект студии бывает общим — мини-карта, прицел и большая карта в одном
 * (так его заводит «Новый проект»), — а ставится по модулю: у мини-карты своя
 * установка, у прицела своя. Считать установкой мини-карты все модули проекта
 * значило отмечать поставленными прицел и карту, которых в игре нет, и
 * выделять в корзине три плитки там, где отмечена одна. Вид записей прежних
 * версий неизвестен — для них остаются все модули проекта.
 */
const INSTALL_KIND_MODULES = Object.freeze({
  "native-minimap": Object.freeze(["minimap"]),
  "native-reticle": Object.freeze(["crosshair", "sniper-scope"]),
  "world-map": Object.freeze(["world-map"]),
  "native-world-map": Object.freeze(["world-map"]),
  "local-legacy-climbs": Object.freeze(["climbs"]),
});

/* Плитка эффектов → часть набора, который уезжает в игру одним патчем. */
export const EFFECTS_SLOT_PARTS = Object.freeze(
  Object.fromEntries(
    Object.values(WORK_KINDS)
      .filter((kind) => kind.type === "effects")
      .map((kind) => [kind.slotId, kind.part]),
  ),
);

const EFFECTS_PART_SLOTS = Object.freeze(
  Object.fromEntries(
    Object.entries(EFFECTS_SLOT_PARTS).map(([slotId, part]) => [part, slotId]),
  ),
);

/**
 * Какие части набора эффектов стоят в игре — по снимку набора.
 *
 * Мерка одна на полку и на корзину: плитка стоит на полке ровно тогда, когда
 * её часть здесь названа, и пересборка без отмеченного оставляет в игре
 * ровно то, что здесь названо после неё. Снимка нет — непонятно, что стоит, и
 * считаются все три: «установлено» ближе к правде, чем «не установлено» при
 * живой точке восстановления.
 *
 * @param {object|null} project снимок набора (`installedProject`)
 * @returns {string[]} части в порядке полки: `tracer`, `impact`, `environment`
 */
export function installedEffectsParts(project) {
  if (!project || typeof project !== "object")
    return ["tracer", "impact", "environment"];
  return [
    /* Выстрел стволов (вспышки, дым, гильзы из студии ствола) живёт на
       карточке трейсеров: и то и другое — пуля и ствол в одном файле. */
    ...(effectsTracerActive(project.tracer) ||
    ["flashes", "smokes", "shells"].some(
      (list) => (project.muzzle?.[list] || []).length > 0,
    ) ||
    /* «Без вспышки и дыма» (задача 6 ТЗ 17.10.2026): «all» или список. */
    project.muzzle?.quiet === "all" ||
    (Array.isArray(project.muzzle?.quiet) && project.muzzle.quiet.length > 0)
      ? ["tracer"]
      : []),
    ...(project.impact?.enabled ? ["impact"] : []),
    /* Любое включённое семейство окружения: огонь, вспышки, взрывы, дым —
       все они живут в редакторе «Огонь и взрывы». */
    ...(Object.values(project.environment || {}).some(
      (family) => family?.enabled,
    )
      ? ["environment"]
      : []),
  ];
}

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* Только для чтения: снимает повторный разбор больших записей, ответ общий (`stored-json.js`). */
const readShared = readStoredJson;

function writeJson(storage, key, value) {
  try {
    if (value === null || value === undefined) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const text = (value) => (typeof value === "string" ? value : "");

/*
 * Имя работы в записи отдельного редактора. Своего `name` у записи нет —
 * его несёт снимок поставленной правки (`installedState`, его пишет
 * `installEditorWork`): килл-эффект, поставленный из «Багрового», на полке
 * библиотеки так и называется, а не описанием плитки.
 */
function recordName(record) {
  const own = text(record?.name);
  if (own) return own;
  return storedStateName(text(record?.installedState));
}

/*
 * Как снимается установка — по тому, что в записи есть. Мод движка узнаётся
 * по `modId` (большая карта, залазы, арена, Мегамолл ставятся движком), точка
 * нативного хоста — по `restorePointId`; у старой нативной большой карты есть
 * оба, и решает её `kind`.
 */
function removalOf(record, { fivem = false } = {}) {
  const kind = text(record?.kind);
  const modId = text(record?.modId);
  const restorePointId = text(record?.restorePointId);
  if (modId && !kind.startsWith("native-"))
    return { kind: "mod", key: `mod:${modId}`, modId };
  if (restorePointId)
    return {
      kind: "native",
      key: `native:${restorePointId}`,
      restorePointId,
      patch: text(record?.patch),
    };
  if (modId) return { kind: "mod", key: `mod:${modId}`, modId };
  const installId = text(record?.installId);
  if (installId && fivem)
    return { kind: "resource", key: `resource:${installId}`, installId };
  return null;
}

/**
 * Установки из мастерской, которые сейчас числятся в игре.
 *
 * @param {Storage} [storage]
 * @returns {Array<{
 *   key: string,
 *   kind: "native"|"mod"|"resource"|"record",
 *   name: string,
 *   slots: string[],
 *   split?: "effects",
 *   sourceModId?: string,
 *   restorePointId?: string,
 *   patch?: string,
 *   modId?: string,
 *   installId?: string,
 *   installedAt: string,
 *   origin: object,
 * }>}
 */
export function readWorkshopInstallUnits(storage = globalThis.localStorage) {
  /* Снятое проверкой файлов игры — не в игре (задача 2 ТЗ 10.10.2026): его
     записи остаются для «Установить снова» (`parked-installs.js`). */
  const parked = readParkedInstalls(storage);
  return collectInstallUnits(storage).filter((unit) => !isParkedUnit(unit, parked));
}

/** Установки, снятые проверкой файлов игры, — по порядку установки. */
export function readParkedWorkshopUnits(storage = globalThis.localStorage) {
  const parked = readParkedInstalls(storage);
  return collectInstallUnits(storage)
    .filter((unit) => isParkedUnit(unit, parked))
    .sort((a, b) => text(a.installedAt).localeCompare(text(b.installedAt)));
}

function collectInstallUnits(storage) {
  const units = [];
  if (!storage) return units;
  const push = (unit) => {
    if (!unit.slots.length) return;
    units.push(unit);
  };

  for (const [slotId, key] of [...Object.entries(RECORD_KEYS), ...LEGACY_SLOT_RECORDS]) {
    const record = readShared(storage, key);
    if (!record) continue;
    const common = {
      name: recordName(record),
      slots: [slotId],
      installedAt: text(record.installedAt),
      origin: { type: "key", key },
      /* Режим RP: что легло контейнером и что нет — кодами (`install-queue/tasks/rp-words.js`); слова «Библиотеки» собирает окно. Режим выключен — поля нет, юнит прежний. */
      ...(record.rp && typeof record.rp === "object" ? { rp: record.rp } : {}),
    };
    /* Запись без точки восстановления (или без modId у арены) — не установка:
       ровно так её отбрасывает и сам редактор. */
    const removal = removalOf(record);
    if (removal) push({ ...removal, ...common });
    /* Мод слоя Astral рядом с точкой (фонари: модели — пакетом движка,
       файлы update.rpf — патчем) — вторая установка той же карточки:
       корзина снимает её вместе с первой. */
    const layerModId = text(record.layerModId);
    if (layerModId)
      push({
        kind: "mod",
        key: `mod:${layerModId}`,
        modId: layerModId,
        ...common,
      });
  }

  /* Патч эффектов один на все модули студии; какие из них в нём есть, знает
     снимок установленного набора в записи установки. Запись прежних версий
     его не несёт — тогда черновик редактора (`installedEffectsParts`). */
  const effects = readShared(storage, EFFECTS_RECORD_KEY);
  if (effects?.restorePointId) {
    const project =
      (effects.installedProject && typeof effects.installedProject === "object"
        ? effects.installedProject
        : null) || readShared(storage, EFFECTS_PROJECT_KEY);
    /* Имя — то, что человек дал работе в «Моих работах» («Карабин и
       снайперки»), а не имя черновика по умолчанию. */
    const work = text(effects.workId)
      ? readWorksStore(storage).works.find((item) => item.id === effects.workId)
      : null;
    push({
      ...removalOf(effects),
      name: text(work?.name) || text(project?.name),
      slots: installedEffectsParts(project).map(
        (part) => EFFECTS_PART_SLOTS[part],
      ),
      /* Снимается по частям: отмеченные трейсеры уходят, попадания остаются. */
      split: "effects",
      installedAt: text(effects.installedAt),
      origin: { type: "key", key: EFFECTS_RECORD_KEY },
    });
  }

  /* Студия звуков: звук каждого ствола — свой мод на карточке «Звуки
     оружия», попадания — один мод на карточках головы и тела. */
  for (const unit of soundKitUnits(storage)) push(unit);

  /* Покраска одежды и работы тату (задача 3 ТЗ 06.10.2026, вечер): каждая
     вещь и каждая работа — своя карточка полки (`clothing-item:…`). */
  for (const unit of clothingPaintUnits(storage)) push(unit);

  /* Скины стволов и стволы паков из мастерской (ТЗ 24.10.2026, п. 5): своя
     запись на каждый ствол, карточка полки «Оружие» — `weapon-skin:…`. */
  for (const unit of weaponSkinUnits(storage)) push(unit);

  const projects = readShared(storage, PROJECTS_KEY);
  for (const project of Array.isArray(projects) ? projects : []) {
    const installations = Array.isArray(project?.installations)
      ? project.installations
      : [];
    const moduleIds = Array.isArray(project?.enabledModules)
      ? project.enabledModules
      : Object.keys(project?.modules || {});
    const slotsOf = (modules) => [
      ...new Set(
        modules.flatMap((moduleId) => STUDIO_MODULE_SLOTS[moduleId] || []),
      ),
    ];
    installations.forEach((installation, index) => {
      if (installation?.status !== "active") return;
      const carried = INSTALL_KIND_MODULES[text(installation.kind)];
      const own = carried
        ? moduleIds.filter((moduleId) => carried.includes(moduleId))
        : moduleIds;
      /* Модуля, который установка везёт, в проекте уже нет (его выключили
         после установки) — в игре он от этого не пропал. */
      const slots = slotsOf(own.length ? own : carried || moduleIds);
      const removal = removalOf(installation, {
        fivem: project.target === "fivem",
      }) || {
        /* Установка без понятного способа снятия: полка её показывает, а
           корзина честно скажет, что снять её отсюда нельзя. */
        kind: "record",
        key: `record:${project.id || ""}:${installation.installId || index}`,
      };
      push({
        ...removal,
        name: text(project.name),
        slots,
        sourceModId: text(project.sourceModId),
        installedAt: text(installation.installedAt),
        origin: {
          type: "project",
          projectId: text(project.id),
          installId: text(installation.installId),
          index,
        },
      });
    });
  }

  return units;
}

/**
 * @param {Storage} [storage]
 * @returns {Map<string, { name: string, sourceModId?: string }>} слот → отметка
 *   об установке. `sourceModId` есть у работ студии: по нему студия находит
 *   тот самый проект, и библиотека открывает его, а не заводит новый.
 */
export function readWorkshopInstallMarks(storage = globalThis.localStorage) {
  return marksFromUnits(readWorkshopInstallUnits(storage));
}

/*
 * Отметки по уже прочитанным установкам — чтобы не разбирать хранилище
 * дважды.
 *
 * На одной карточке бывает несколько установок — звуки трёх стволов на
 * «Звуках оружия», — и подпись называет их все, а не первую попавшуюся:
 * «Карабинная винтовка, Пистолет и ещё 2». Своё имя у установки на
 * конкретной карточке (`slotNames`) главнее общего: у попаданий голова и
 * тело — один мод, но звук у каждой части свой.
 */
export function marksFromUnits(units = []) {
  const names = new Map();
  const marks = new Map();
  for (const unit of units) {
    for (const slotId of unit.slots) {
      const name = unit.slotNames?.[slotId] || unit.name;
      if (!names.has(slotId)) names.set(slotId, []);
      if (name && !names.get(slotId).includes(name)) names.get(slotId).push(name);
      if (marks.has(slotId)) continue;
      marks.set(slotId, {
        name,
        ...(unit.sourceModId ? { sourceModId: unit.sourceModId } : {}),
      });
    }
  }
  for (const [slotId, list] of names) {
    if (list.length < 2) continue;
    marks.get(slotId).name = installNamesLine(list);
  }
  return marks;
}

/** Подпись карточки с несколькими работами: «Карабинная винтовка, Пистолет и ещё 2». Одна на полку библиотеки и сборки (`library/work-cards.js`). */
export function installNamesLine(names = []) {
  const list = [...new Set(names.filter(Boolean))];
  const shown = list.slice(0, 2).join(", ");
  return list.length > 2 ? tr("{0} и ещё {1}").replace("{0}", shown).replace("{1}", String(list.length - 2)) : shown;
}

const normalizedPath = (value) =>
  text(value).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();

/*
 * Обходит все записи, у которых есть точка отката или мод, и даёт
 * переписать каждую. `visit(record)` возвращает новую запись, `null` —
 * удалить запись, `undefined` — оставить как есть.
 */
function rewriteRecords(storage, visit) {
  let changed = false;
  for (const key of [
    ...Object.values(RECORD_KEYS),
    ...LEGACY_SLOT_RECORDS.map(([, key]) => key),
    EFFECTS_RECORD_KEY,
    ...SHELFLESS_RECORD_KEYS,
  ]) {
    const record = readJson(storage, key);
    if (!record) continue;
    const next = visit(record, { type: "key", key });
    if (next === undefined) continue;
    changed = writeJson(storage, key, next) || changed;
  }
  const projects = readJson(storage, PROJECTS_KEY);
  if (Array.isArray(projects)) {
    let projectsChanged = false;
    const nextProjects = projects.map((project) => {
      if (!Array.isArray(project?.installations)) return project;
      let touched = false;
      const installations = project.installations.map((installation) => {
        if (installation?.status !== "active") return installation;
        const next = visit(installation, {
          type: "project",
          projectId: text(project.id),
        });
        if (next === undefined) return installation;
        touched = true;
        return next === null
          ? {
              ...installation,
              status: "rolled-back",
              rolledBackAt: new Date().toISOString(),
            }
          : next;
      });
      if (!touched) return project;
      projectsChanged = true;
      return { ...project, installations };
    });
    if (projectsChanged)
      changed = writeJson(storage, PROJECTS_KEY, nextProjects) || changed;
  }
  return changed;
}

function remapRecord(record, oldId, target) {
  return {
    ...record,
    restorePointId: target.restorePointId,
    ...(record.installId === oldId ? { installId: target.restorePointId } : {}),
    ...(record.id === oldId ? { id: target.restorePointId } : {}),
    ...(target.patch ? { patch: target.patch } : {}),
  };
}

/**
 * Переписывает записи после удаления из библиотеки.
 *
 * Снятое уходит из записей (у проекта студии установка помечается
 * откатанной — история работы остаётся при ней), переставленные на место
 * работы получают новые имена точек, а то, что снять не удалось, остаётся
 * как было.
 *
 * `result` — ответ `removeFromLibrary`; `extra` — то, что окно сняло само:
 * ресурсы FiveM и записи без способа снятия.
 */
export function applyLibraryRemovalResult(
  storage = globalThis.localStorage,
  result = {},
  extra = {},
) {
  if (!storage) return false;
  const removedNatives = new Set();
  for (const item of result.natives || []) {
    /* `squashed` — прежняя версия работы слилась с новой при её установке. */
    if (!["remove", "forget", "missing", "squashed"].includes(item?.action))
      continue;
    if (item.restorePointId) removedNatives.add(item.restorePointId);
    if (item.resolvedId) removedNatives.add(item.resolvedId);
  }
  for (const item of result.lost || [])
    if (item?.restorePointId) removedNatives.add(item.restorePointId);
  const failedMods = new Set(
    (result.failedMods || []).map((item) => item?.modId),
  );
  const removedMods = new Set(
    (result.mods || [])
      .filter(
        (item) =>
          ["remove", "missing"].includes(item?.action) &&
          !failedMods.has(item.modId),
      )
      .map((item) => item.modId),
  );
  const remap = new Map(Object.entries(result.remap || {}));
  const removedInstallIds = new Set(extra.installIds || []);
  /* Звуки студии — моды движка в своей записи (стволы и попадания разом). */
  const soundsChanged = forgetSoundKitMods(storage, removedMods);
  const clothingChanged = forgetClothingPaintMods(storage, removedMods);
  const weaponChanged = forgetWeaponSkinMods(storage, removedMods);

  const recordsChanged = rewriteRecords(storage, (record, origin) => {
    const restorePointId = text(record.restorePointId);
    const modId = text(record.modId);
    const layerModId = text(record.layerModId);
    if (origin.type === "project" && removedInstallIds.has(record.installId))
      return null;
    /* Запись о двух установках (точка и мод слоя) теряет только снятую
       часть: мод, который снять не вышло, остаётся в игре — и в записи. */
    const layerGone = Boolean(layerModId) && removedMods.has(layerModId);
    let next = record;
    if (restorePointId && remap.has(restorePointId))
      next = remapRecord(next, restorePointId, remap.get(restorePointId));
    else if (restorePointId && removedNatives.has(restorePointId)) {
      if (!layerModId || layerGone) return null;
      const { restorePointId: _point, patch: _patch, ...rest } = next;
      next = rest;
    } else if (modId && removedMods.has(modId)) return null;
    if (layerGone) {
      if (!text(next.restorePointId)) return null;
      const { layerModId: _layer, ...rest } = next;
      next = rest;
    }
    return next === record ? undefined : next;
  });
  return soundsChanged || clothingChanged || weaponChanged || recordsChanged;
}

/**
 * Сверяет записи с точками, которые на самом деле лежат на диске.
 *
 * Библиотека переставляет работы на место под новыми именами точек и сразу
 * переписывает записи. Если окно закрыли раньше, чем ответ дошёл, запись
 * осталась со старым именем — но патч у новой точки тот же, и по нему её
 * можно найти. `items` — `native.items` из ответа `getLibraryStatus`.
 */
export function reconcileWorkshopInstallRecords(
  storage = globalThis.localStorage,
  items = [],
) {
  if (!storage || !Array.isArray(items) || !items.length) return false;
  const ids = new Set(items.map((item) => item.id));
  return rewriteRecords(storage, (record) => {
    const restorePointId = text(record.restorePointId);
    const patch = normalizedPath(record.patch);
    if (!restorePointId || ids.has(restorePointId) || !patch) return undefined;
    const candidates = items.filter(
      (item) => normalizedPath(item.patch) === patch,
    );
    const match =
      candidates.filter((item) => item.state === "applied").at(-1) ||
      candidates.at(-1);
    if (!match) return undefined;
    return remapRecord(record, restorePointId, {
      restorePointId: match.id,
      patch: match.patch,
    });
  });
}

/**
 * Игра переехала в другую папку (задача 1 ТЗ 10.10.2026): записи установок,
 * помнящие прежнюю папку, — за новой. Иначе снятие из редактора искало бы
 * игру по пути, которого больше нет.
 */
export function rewriteMovedGameRecords(
  from,
  to,
  storage = globalThis.localStorage,
) {
  const source = normalizedPath(from);
  if (!storage || !source || !to || source === normalizedPath(to)) return false;
  return rewriteRecords(storage, (record) =>
    typeof record?.gameRoot === "string" && normalizedPath(record.gameRoot) === source
      ? { ...record, gameRoot: String(to) }
      : undefined,
  );
}

/*
 * Записи установок вне реестра полки: скины стволов и одежды (их слои
 * «Вернуть без модов» стирает вместе с DLC Astral), прежняя студия арены,
 * флаг «радуга в игре» и память сборки о поставленных студийных работах.
 * Ключи — буквами, чтобы этот модуль не тянул задачи очереди в стартовый
 * кусок; совпадение с источниками сверяет `forget-after-reset.test.js`.
 */
export const AFTER_RESET_KEYS = Object.freeze([
  "astral.gun-studio.install.v1",
  "astral.gun-studio.pack-install.v1",
  "astral.clothing-studio.install.v1",
  "astral.arena-studio.install.v1",
  "astral.timecycle.rainbow.v1",
  "astral.build-works.studio.v1",
  SOUND_KIT_INSTALL_KEY,
]);

/**
 * После «Вернуть GTA V без модов» в игре нет ни одной работы мастерской:
 * архив и файлы игры вернулись к основе. Записи об установках — единственное,
 * что об этом не знало: редактор говорил «в игре», а сборка отвечала «уже
 * стоит» и не ставила работу заново. Здесь все записи забываются разом
 * (у проекта студии установка помечается откатанной — история остаётся).
 * Точки отката на диске не трогаются: они уже «отцеплены» и уходят уборкой кэша.
 */
export function forgetWorkshopInstallsAfterReset(
  storage = globalThis.localStorage,
) {
  if (!storage) return false;
  let changed = rewriteRecords(storage, () => null);
  for (const key of AFTER_RESET_KEYS) {
    let had = false;
    try {
      had = storage.getItem(key) !== null;
    } catch {
      had = false;
    }
    if (had) changed = writeJson(storage, key, null) || changed;
  }
  return changed;
}
