/*
 * Оружие трассеров: какие файлы игры правятся и как снимается прежняя правка.
 *
 * У базовых стволов описание лежит в `common/data/ai/weapons.meta` внутри
 * update.rpf. У стволов дополнений (MK2, тяжёлая винтовка, служебный
 * карабин…) — в файле своего пакета, и игра читает его не из `dlc.rpf`
 * пакета, а из `update.rpf/dlc_patch/<пакет>/<путь>`, если такой файл есть:
 * `common/data/extratitleupdatedata.meta` монтирует эти папки поверх пакетов
 * (`dlc_mpGunRunning:/` → `update:/dlc_patch/mpGunrunning/`), и так Rockstar
 * правит оружие дополнений после выпуска. Мастерская кладёт правленый файл по
 * тому же адресу — игра берёт его первым, а update.rpf остаётся единственным
 * архивом, который трогает установка, с той же точкой восстановления.
 *
 * Базой служит то, что лежит в игре сейчас, — а там после прошлой установки
 * уже стоит наша правка. Поэтому у установки есть журнал: для каждого
 * тронутого ствола запоминается, что было до Astral (правило и шансы), и
 * следующая установка возвращает это стволам, которые из набора выпали.
 * Без журнала снятый с карабина трассер жил бы в игре и дальше: слот-то в
 * ядре остаётся. Журнала может не быть (установка прежней версии, потерянная
 * запись) — тогда ствол со слотом Astral, которого нет в наборе, получает
 * штатный след из таблицы стволов, снятой с живой игры.
 *
 * Вспышка выстрела (`<FlashFx>`) ведётся тем же журналом, но своим полем:
 * след и вспышку ставят и снимают порознь, и запись о вспышке не должна
 * вернуть след (и наоборот). Сирота-вспышка лечится без журнала — донор
 * записан в имени клона (`muzzleDonorOf`). Так же — дым из ствола
 * (`<MuzzleSmokeFx>`, клон `astral_smoke_*`). Размер и свет вспышки,
 * накопление дыма и гильзы — числа и имена без донора в имени: их исходные
 * значения журнал держит полем `look` (`muzzle-look.js`).
 */

import {
  ASTRAL_TRACER_SLOTS,
  TRACER_BASE_WEAPONS_ENTRY,
  findStudioTracerWeapon,
  isAstralMuzzle,
  isAstralSmoke,
  isCatalogTracerRule,
  muzzleDonorOf,
  smokeDonorOf,
  tracerWeaponSource,
} from "@modovik/tracer-contract";
import { STUDIO_MUZZLE_STOCK } from "@modovik/tracer-contract/muzzle-stock.js";
import {
  LOOK_JOURNAL_VERSION,
  boundedLook,
  lookFields,
  lookOriginalOf,
  lookOriginals,
  lookValues,
  readMuzzleLook,
  sameLookValue,
} from "./muzzle-look.js";

const WEAPON_NAME = /^WEAPON_[A-Z0-9_]{1,60}$/;
const TRACER_NAME = /^[A-Za-z0-9_]{0,96}$/;
const MAX_JOURNAL_BYTES = 256 * 1024;
const MAX_JOURNAL_FILES = 64;
const BASE_TARGET = `update:/${TRACER_BASE_WEAPONS_ENTRY}`;

/* Правило слота Astral: его в игре быть не должно, если набор его не ставит. */
const slotRules = new Set(ASTRAL_TRACER_SLOTS.map((slot) => slot.rule));
const isAstralRule = (name) => slotRules.has(String(name || "").toLowerCase());

const chance = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1
    ? Math.round(number * 1e6) / 1e6
    : null;
};

/**
 * Журнал прошлой установки — как его принесло окно: проверяется целиком, а
 * непонятный молча отбрасывается, как и журнал крови.
 */
export function boundedTracerJournal(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  let files;
  try {
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized, "utf8") > MAX_JOURNAL_BYTES) return null;
    files = JSON.parse(serialized).files;
  } catch {
    return null;
  }
  if (!Array.isArray(files)) return null;
  const result = [];
  for (const file of files.slice(0, MAX_JOURNAL_FILES)) {
    const target = String(file?.target || "").trim();
    if (!/^update:\/[a-z0-9_./-]+\.meta$/i.test(target)) continue;
    if (target.includes("..")) continue;
    const weapons = [];
    for (const item of Array.isArray(file.weapons) ? file.weapons : []) {
      const weapon = String(item?.weapon || "").trim();
      if (!WEAPON_NAME.test(weapon)) continue;
      /* Поле, которого в записи нет, не возвращается: запись о вспышке без
         следа не должна стереть след. Прежние журналы след несут всегда. */
      const hasTracer = item.tracerFx !== undefined && item.tracerFx !== null;
      const tracerFx = hasTracer ? String(item.tracerFx).trim() : null;
      const flashFx =
        item.flashFx === undefined || item.flashFx === null
          ? null
          : String(item.flashFx).trim();
      /* Правило Astral «оригиналом» не бывает: такую запись журнал вести не
         мог, и возвращать её значило бы вернуть нашу же правку. */
      const tracerOk =
        hasTracer && TRACER_NAME.test(tracerFx) && !isAstralRule(tracerFx);
      const flashOk =
        flashFx !== null &&
        flashFx.length > 0 &&
        TRACER_NAME.test(flashFx) &&
        !isAstralMuzzle(flashFx);
      /* Дым «оригиналом» бывает и пустым: у ствола своего дыма не было. */
      const smokeFx =
        item.smokeFx === undefined || item.smokeFx === null
          ? null
          : String(item.smokeFx).trim();
      const smokeOk =
        smokeFx !== null && TRACER_NAME.test(smokeFx) && !isAstralSmoke(smokeFx);
      const look = boundedLook(item.look);
      if (!tracerOk && !flashOk && !smokeOk && !look) continue;
      weapons.push({
        weapon,
        ...(tracerOk
          ? {
              tracerFx,
              chanceSP: chance(item.chanceSP),
              chanceMP: chance(item.chanceMP),
            }
          : {}),
        ...(flashOk ? { flashFx } : {}),
        ...(smokeOk ? { smokeFx } : {}),
        ...(look ? { look } : {}),
        ...(look && item.lookV === LOOK_JOURNAL_VERSION
          ? { lookV: LOOK_JOURNAL_VERSION }
          : {}),
      });
    }
    if (weapons.length) result.push({ target, weapons });
  }
  return result.length ? { files: result } : null;
}

/**
 * Что сейчас записано у стволов в XML: правило следа и шансы.
 *
 * Разбор нарочно простой: у каждого CWeaponInfo первым полем идёт `<Name>`,
 * а блок `<Fx>` с полями следа — один. Пишет файл помощник RPF настоящим
 * XML-разбором; здесь только читается, что было до правки. `weapons` —
 * какие стволы нужны; `null` — все, что есть в файле.
 */
export function readTracerBindings(xml, weapons = null) {
  const wanted = weapons ? new Set(weapons) : null;
  const result = new Map();
  const text = String(xml || "");
  const matches = [...text.matchAll(/<Name>(WEAPON_[A-Z0-9_]+)<\/Name>/g)];
  matches.forEach((match, index) => {
    const name = match[1];
    if ((wanted && !wanted.has(name)) || result.has(name)) return;
    const from = match.index;
    const to =
      index + 1 < matches.length ? matches[index + 1].index : text.length;
    const block = text.slice(from, to);
    const fx = /<TracerFx>([^<]*)<\/TracerFx>|<TracerFx\s*\/>/.exec(block);
    if (!fx) return;
    const flash = /<FlashFx>([^<]*)<\/FlashFx>|<FlashFx\s*\/>/.exec(block);
    const smoke =
      /<MuzzleSmokeFx>([^<]*)<\/MuzzleSmokeFx>|<MuzzleSmokeFx\s*\/>/.exec(
        block,
      );
    result.set(name, {
      weapon: name,
      tracerFx: (fx[1] || "").trim(),
      chanceSP: chance(/<TracerFxChanceSP\s+value="([^"]+)"/.exec(block)?.[1]),
      chanceMP: chance(/<TracerFxChanceMP\s+value="([^"]+)"/.exec(block)?.[1]),
      /* Вспышка у дула; `null` — поля у ствола нет. */
      flashFx: flash ? (flash[1] || "").trim() : null,
      /* Дым из ствола; `null` — поля у ствола нет. */
      smokeFx: smoke ? (smoke[1] || "").trim() : null,
      /* Размер и свет вспышки, накопление дыма и гильзы. */
      look: readMuzzleLook(block),
    });
  });
  return result;
}

/* Штатный вид выстрела ствола из исходных файлов игры (`muzzle-stock.js`). */
const stockLook = (weapon) => STUDIO_MUZZLE_STOCK[weapon]?.look || null;

/** Адрес файла ствола в update.rpf — то, что правит установка. */
export function weaponTarget(source) {
  if (!source) return null;
  return source.kind === "base"
    ? `update:/${source.entry}`
    : `update:/${source.patch}`;
}

/**
 * План файлов оружия: по файлу на источник, с привязками этой установки и
 * стволами прошлой, которым надо вернуть штатное.
 *
 * `bindings` — привязки сборки (`{ weapon, tracerFx, chanceSP, chanceMP,
 * source }`), `flashes` — стволы со своей вспышкой (правило клона узнаётся
 * после чтения файла: донор — их нынешний `<FlashFx>`), `previous` — журнал
 * прошлой установки. Файл из журнала, в котором этой установке править
 * нечего, всё равно в плане: его стволы возвращаются к штатному. Базовый
 * weapons.meta в плане всегда: в нём лечатся стволы, которые прежняя версия
 * связала со слотом без журнала.
 */
export function planTracerWeaponFiles({
  bindings = [],
  flashes = [],
  /* Стволы со своим дымом из ствола (клон штатного дыма). */
  smokes = [],
  /* Стволы, у которых меняется вид выстрела в файле: размер и свет
     вспышки, накопление дыма, гильзы. */
  looks = [],
  previous = null,
}) {
  const files = new Map();
  const fileFor = (target, source) => {
    if (!files.has(target))
      files.set(target, {
        target,
        source,
        bindings: [],
        restores: [],
        flashes: [],
        flashRestores: [],
        smokes: [],
        smokeRestores: [],
        looks: [],
        lookRestores: [],
      });
    return files.get(target);
  };
  fileFor(BASE_TARGET, { kind: "base", entry: TRACER_BASE_WEAPONS_ENTRY });
  for (const binding of bindings) {
    const source = binding.source || tracerWeaponSource(binding.weapon);
    const target = weaponTarget(source);
    if (!target)
      throw new Error(`Неизвестный ствол для трассера: ${binding.weapon}`);
    fileFor(target, source).bindings.push({
      weapon: binding.weapon,
      tracerFx: binding.tracerFx,
      chanceSP: binding.chanceSP,
      chanceMP: binding.chanceMP,
    });
  }
  const place = (weapon, list, label) => {
    const source = tracerWeaponSource(weapon);
    const target = weaponTarget(source);
    if (!target) throw new Error(`Неизвестный ствол для ${label}: ${weapon}`);
    const entry = fileFor(target, source);
    if (!entry[list].includes(weapon)) entry[list].push(weapon);
  };
  for (const weapon of flashes) place(weapon, "flashes", "вспышки");
  for (const weapon of smokes) place(weapon, "smokes", "дыма");
  for (const weapon of looks) place(weapon, "looks", "вида выстрела");
  const bound = new Set(bindings.map((item) => item.weapon));
  const flashed = new Set(flashes);
  const smoked = new Set(smokes);
  for (const file of previous?.files || []) {
    /* След и вспышка возвращаются порознь: у записи только те поля, что
       ставила прошлая установка. */
    const restores = file.weapons
      .filter((item) => !bound.has(item.weapon) && item.tracerFx != null)
      .map(({ weapon, tracerFx, chanceSP, chanceMP }) => ({
        weapon,
        tracerFx,
        chanceSP,
        chanceMP,
      }));
    const flashRestores = file.weapons
      .filter((item) => !flashed.has(item.weapon) && item.flashFx)
      .map(({ weapon, flashFx }) => ({ weapon, flashFx }));
    const smokeRestores = file.weapons
      .filter((item) => !smoked.has(item.weapon) && item.smokeFx != null)
      .map(({ weapon, smokeFx }) => ({ weapon, smokeFx }));
    /* Вид — поле к полю: что из журнала не держит новая установка, решает
       расчёт изменений (`weaponFileChanges`), здесь — весь журнал вида. */
    const lookRestores = file.weapons
      .filter((item) => item.look)
      .map(({ weapon, look }) => ({ weapon, look: { ...look } }));
    if (
      !restores.length &&
      !flashRestores.length &&
      !smokeRestores.length &&
      !lookRestores.length
    )
      continue;
    /* Источник файла журнала — по его стволу: все стволы одного файла делят
       и пакет, и путь. Незнакомый ствол (таблица стала другой) источник не
       называет — тогда файл узнаётся по адресу. */
    const known = [
      ...restores,
      ...flashRestores,
      ...smokeRestores,
      ...lookRestores,
    ]
      .map((item) => tracerWeaponSource(item.weapon))
      .find((source) => weaponTarget(source) === file.target);
    const source =
      known ||
      (file.target === BASE_TARGET
        ? { kind: "base", entry: TRACER_BASE_WEAPONS_ENTRY }
        : null);
    /* Файл, которого установка не умеет назвать, не трогается: писать в
       неизвестный адрес хуже, чем оставить ствол как есть. */
    if (!source) continue;
    const entry = fileFor(file.target, source);
    for (const item of restores) entry.restores.push({ ...item });
    for (const item of flashRestores) entry.flashRestores.push({ ...item });
    for (const item of smokeRestores) entry.smokeRestores.push({ ...item });
    for (const item of lookRestores) entry.lookRestores.push({ ...item });
  }
  /* Имена файлов в payload — по порядку плана: базовый первым. */
  return [...files.values()].map((file, index) => ({
    ...file,
    file: index === 0 ? "weapons.meta" : `weapons-${index}.meta`,
  }));
}

/** Штатный след ствола из таблицы, снятой с живой игры. */
function vanillaOf(weapon) {
  const original = findStudioTracerWeapon(weapon)?.vanilla;
  return original
    ? {
        weapon,
        tracerFx: original.tracerFx,
        chanceSP: original.chanceSP,
        chanceMP: original.chanceMP,
      }
    : null;
}

/* Записи журнала прошлой установки для этого файла — по стволу. */
const journalOf = (file, previous) =>
  new Map(
    (previous?.files || [])
      .filter((item) => item.target === file.target)
      .flatMap((item) => item.weapons.map((weapon) => [weapon.weapon, weapon])),
  );

/*
 * Штатная вспышка ствола — донор клона: запись журнала, иначе то, что стоит
 * сейчас (у клона Astral — его донор из имени). `null` — вспышки у ствола
 * нет, и копировать нечего.
 */
function flashOriginalOf(weapon, journal, current) {
  const known = journal.get(weapon)?.flashFx;
  if (known) return known;
  const now = current.get(weapon)?.flashFx;
  if (!now) return null;
  return muzzleDonorOf(now) || (isAstralMuzzle(now) ? null : now);
}

/**
 * Доноры вспышек этого файла: ствол → штатное правило `<FlashFx>` (или
 * `null`). По ним установщик называет и строит клоны до правки файла.
 */
export function flashDonors({ file, current, previous }) {
  const journal = journalOf(file, previous);
  return new Map(
    (file.flashes || []).map((weapon) => [
      weapon,
      current.has(weapon) ? flashOriginalOf(weapon, journal, current) : null,
    ]),
  );
}

/*
 * Штатный дым ствола: запись журнала, иначе то, что стоит сейчас (у клона
 * Astral — его донор из имени). Пустая строка — своего дыма у ствола нет;
 * `null` — поля `<MuzzleSmokeFx>` у ствола нет вовсе.
 */
function smokeOriginalOf(weapon, journal, current) {
  const known = journal.get(weapon)?.smokeFx;
  if (known !== undefined && known !== null) return known;
  const now = current.get(weapon)?.smokeFx;
  if (now === null || now === undefined) return null;
  return smokeDonorOf(now) || (isAstralSmoke(now) ? "" : now);
}

/**
 * Дым стволов этого файла: ствол → `{ original, present }` — штатное правило
 * дыма (пустое, если своего нет) и есть ли у ствола поле дыма вообще.
 */
export function smokeDonors({ file, current, previous }) {
  const journal = journalOf(file, previous);
  return new Map(
    (file.smokes || []).map((weapon) => {
      const original = current.has(weapon)
        ? smokeOriginalOf(weapon, journal, current)
        : null;
      return [weapon, { original, present: original !== null }];
    }),
  );
}

/**
 * Что записать в файл: привязки этой установки, возврат выпавших стволов и
 * лечение стволов, связанных со слотом Astral без журнала. Возвращает и
 * запись журнала этого файла — что было у привязанных стволов до Astral.
 *
 * `current` — что лежит в файле сейчас (`readTracerBindings(xml)`, все
 * стволы), `previous` — журнал прошлой установки, `flashRules` — ствол →
 * правило клона его вспышки (`muzzleCloneName`). Одна запись на ствол: след
 * и вспышка одного ствола уходят помощнику вместе.
 */
export function weaponFileChanges({
  file,
  current,
  previous,
  flashRules = new Map(),
  /* Ствол → клон его дыма (`smokeCloneName`). */
  smokeRules = new Map(),
  /* Ствол → желаемый вид выстрела (`lookFields`/`lookValues`). */
  lookSpecs = new Map(),
  /* Правила ядра игрока (строчными) — для пар «_fp» у сирот. */
  coreRules = null,
}) {
  const journal = journalOf(file, previous);
  /* След карточки каталога (слоты 100…115), которого в ядре игрока уже нет: карточку сняли, пока ствол держала
     мастерская («Убрать след», свой след). Вернуть ствол на него — значит оставить привязку в пустоту. */
  const catalogGone = (tracerFx) =>
    Boolean(coreRules) && isCatalogTracerRule(tracerFx) && !coreRules.has(String(tracerFx).toLowerCase());
  /* Что было у ствола до Astral: запись журнала, иначе то, что лежит сейчас,
     если это не наш же слот, иначе штатное из таблицы. */
  const originalOf = (weapon) => {
    const known = journal.get(weapon);
    if (known && known.tracerFx != null) return catalogGone(known.tracerFx) ? vanillaOf(weapon) || known : known;
    const now = current.get(weapon);
    if (now && !isAstralRule(now.tracerFx)) {
      /* Пустой след у ствола, которому Rockstar его давала, — наше прежнее
         «Без трассера» при потерянном журнале, а не штатное: оригиналом
         считается штатное из таблицы, иначе снятие вернуло бы «пусто». */
      const stock = vanillaOf(weapon);
      if (now.tracerFx === "" && stock && stock.tracerFx !== "") return stock;
      return now;
    }
    return vanillaOf(weapon);
  };
  const bound = new Set(file.bindings.map((item) => item.weapon));
  const flashed = new Set(
    [...flashRules.keys()].filter((weapon) =>
      (file.flashes || []).includes(weapon),
    ),
  );
  const missing = [
    ...new Set([
      ...file.bindings.map((item) => item.weapon),
      ...(file.flashes || []),
      ...(file.smokes || []),
      ...(file.looks || []),
    ]),
  ].filter((weapon) => !current.has(weapon));
  const restores = new Map(
    file.restores
      .filter((item) => !bound.has(item.weapon) && current.has(item.weapon))
      .map((item) => [item.weapon, catalogGone(item.tracerFx) && vanillaOf(item.weapon) ? { ...vanillaOf(item.weapon), weapon: item.weapon } : { ...item }]),
  );
  /* Сироты: ствол держит слот Astral, а в наборе его нет и журнал о нём
     молчит — ставила прежняя версия. Возвращается штатное. */
  for (const [weapon, now] of current) {
    if (bound.has(weapon) || restores.has(weapon)) continue;
    if (!isAstralRule(now.tracerFx)) continue;
    const original = vanillaOf(weapon);
    if (original) restores.set(weapon, original);
  }
  /* Вспышки: выпавшие из набора — к записи журнала, сироты — к донору из
     имени клона. */
  const flashRestores = new Map(
    (file.flashRestores || [])
      .filter((item) => !flashed.has(item.weapon) && current.has(item.weapon))
      .map((item) => [item.weapon, item.flashFx]),
  );
  for (const [weapon, now] of current) {
    if (flashed.has(weapon) || flashRestores.has(weapon)) continue;
    if (!isAstralMuzzle(now.flashFx)) continue;
    const donor = muzzleDonorOf(now.flashFx);
    if (donor) flashRestores.set(weapon, donor);
  }
  /* Дым — так же: свой — клон, выпавший — к журналу, сирота — к донору. */
  const smoked = new Set(
    [...smokeRules.keys()].filter((weapon) =>
      (file.smokes || []).includes(weapon),
    ),
  );
  const smokeRestores = new Map(
    (file.smokeRestores || [])
      .filter((item) => !smoked.has(item.weapon) && current.has(item.weapon))
      .map((item) => [item.weapon, item.smokeFx]),
  );
  for (const [weapon, now] of current) {
    if (smoked.has(weapon) || smokeRestores.has(weapon)) continue;
    if (!isAstralSmoke(now.smokeFx)) continue;
    const donor = smokeDonorOf(now.smokeFx);
    if (donor) smokeRestores.set(weapon, donor);
  }
  /*
   * Вид выстрела — поле к полю: поля, которые держит эта установка, — свои
   * значения от исходных; поля журнала, которых она больше не держит, —
   * назад к исходным. Поля, которого у ствола в файле нет, не пишем:
   * помощник отказал бы на нём, — оно уходит в `lookMissing`.
   */
  const lookPatch = new Map();
  const lookNotes = new Map();
  const lookMissing = [];
  for (const weapon of file.looks || []) {
    if (!lookSpecs.has(weapon) || !current.has(weapon)) continue;
    const spec = lookSpecs.get(weapon);
    const original = lookOriginals(
      lookFields(spec),
      journal.get(weapon)?.look,
      current.get(weapon).look,
      {
        stock: stockLook(weapon),
        trusted: journal.get(weapon)?.lookV === LOOK_JOURNAL_VERSION,
      },
    );
    const { look, missing: absent } = lookValues(spec, original);
    for (const field of absent) lookMissing.push({ weapon, field });
    if (!Object.keys(look).length) continue;
    lookPatch.set(weapon, look);
    lookNotes.set(
      weapon,
      Object.fromEntries(
        Object.keys(look).map((field) => [field, original[field]]),
      ),
    );
  }
  /*
   * Вид от первого лица: та же вспышка и тот же дым, что от третьего, —
   * иначе в виде из глаз ствол стрелял бы штатно. Исходное правило — в
   * журнал вида, снятие вернёт его тем же полем.
   */
  const firstPerson = (weapon, field, rule, isAstral) => {
    const now = current.get(weapon)?.look?.[field];
    if (now === null || now === undefined) return;
    const original = lookOriginalOf(field, {
      journal: journal.get(weapon)?.look,
      trusted: journal.get(weapon)?.lookV === LOOK_JOURNAL_VERSION,
      stock: stockLook(weapon),
      current: isAstral(now) ? null : current.get(weapon)?.look,
    });
    lookPatch.set(weapon, { ...(lookPatch.get(weapon) || {}), [field]: rule });
    if (original !== null)
      lookNotes.set(weapon, {
        ...(lookNotes.get(weapon) || {}),
        [field]: original,
      });
  };
  for (const weapon of flashed)
    if (current.has(weapon))
      firstPerson(weapon, "flashFxFP", flashRules.get(weapon), isAstralMuzzle);
  for (const weapon of smoked)
    if (current.has(weapon))
      firstPerson(weapon, "smokeFxFP", smokeRules.get(weapon), isAstralSmoke);
  const lookRestored = [];
  for (const [weapon, entry] of journal) {
    if (!entry.look || !current.has(weapon)) continue;
    const held = new Set(Object.keys(lookPatch.get(weapon) || {}));
    const now = current.get(weapon).look || {};
    const stock = stockLook(weapon);
    const trusted = entry.lookV === LOOK_JOURNAL_VERSION;
    /* Вид этого ствола вёл Astral: всё, что он больше не держит, — назад к
       исходному (журнал, которому верят, иначе штатная таблица). Поле, уже
       равное исходному, не трогается. */
    const back = {};
    for (const field of new Set([
      ...Object.keys(entry.look),
      ...Object.keys(stock || {}),
    ])) {
      if (held.has(field) || now[field] === null || now[field] === undefined)
        continue;
      const target = lookOriginalOf(field, {
        journal: entry.look,
        trusted,
        stock,
        current: null,
      });
      if (target === null || sameLookValue(now[field], target)) continue;
      back[field] = target;
    }
    if (!Object.keys(back).length) continue;
    lookPatch.set(weapon, { ...(lookPatch.get(weapon) || {}), ...back });
    lookRestored.push(weapon);
  }
  /* Сироты от первого лица: клон Astral в поле «FP», а журнал молчит. Пара
     штатного правила с «_fp» — если она есть в ядре, иначе само правило. */
  const fpOf = (donor) =>
    donor && coreRules?.has(`${donor}_fp`) ? `${donor}_fp` : donor;
  for (const [weapon, now] of current) {
    const held = lookPatch.get(weapon) || {};
    const flashFp = now.look?.flashFxFP;
    if (!flashed.has(weapon) && held.flashFxFP === undefined && isAstralMuzzle(flashFp)) {
      const donor = fpOf(muzzleDonorOf(flashFp));
      if (donor) lookPatch.set(weapon, { ...held, flashFxFP: donor });
    }
    const smokeFp = now.look?.smokeFxFP;
    const held2 = lookPatch.get(weapon) || {};
    if (!smoked.has(weapon) && held2.smokeFxFP === undefined && isAstralSmoke(smokeFp)) {
      const donor = fpOf(smokeDonorOf(smokeFp));
      if (donor) lookPatch.set(weapon, { ...held2, smokeFxFP: donor });
    }
  }

  const patch = new Map();
  const put = (weapon, fields) =>
    patch.set(weapon, { ...(patch.get(weapon) || { weapon }), ...fields });
  for (const item of file.bindings)
    if (current.has(item.weapon))
      put(item.weapon, {
        tracerFx: item.tracerFx,
        chanceSP: item.chanceSP,
        chanceMP: item.chanceMP,
      });
  for (const item of restores.values())
    put(item.weapon, {
      tracerFx: item.tracerFx,
      chanceSP: item.chanceSP,
      chanceMP: item.chanceMP,
    });
  for (const weapon of flashed)
    if (current.has(weapon)) put(weapon, { flashFx: flashRules.get(weapon) });
  for (const [weapon, flashFx] of flashRestores) put(weapon, { flashFx });
  /* Дым и вид уходят помощнику одним полем привязки `look`. */
  const putLook = (weapon, fields) =>
    put(weapon, { look: { ...(patch.get(weapon)?.look || {}), ...fields } });
  for (const [weapon, fields] of lookPatch) putLook(weapon, fields);
  for (const weapon of smoked)
    if (current.has(weapon)) putLook(weapon, { smokeFx: smokeRules.get(weapon) });
  for (const [weapon, smokeFx] of smokeRestores) putLook(weapon, { smokeFx });

  const entries = new Map();
  const note = (weapon, fields) =>
    entries.set(weapon, { ...(entries.get(weapon) || { weapon }), ...fields });
  for (const item of file.bindings) {
    const original = originalOf(item.weapon);
    if (original)
      note(item.weapon, {
        tracerFx: original.tracerFx,
        chanceSP: original.chanceSP,
        chanceMP: original.chanceMP,
      });
  }
  for (const weapon of flashed) {
    const original = flashOriginalOf(weapon, journal, current);
    if (original) note(weapon, { flashFx: original });
  }
  for (const weapon of smoked) {
    const original = smokeOriginalOf(weapon, journal, current);
    if (original !== null) note(weapon, { smokeFx: original });
  }
  for (const [weapon, look] of lookNotes)
    note(weapon, { look, lookV: LOOK_JOURNAL_VERSION });
  return {
    missing,
    patch: [...patch.values()],
    restored: [...restores.keys()],
    flashRestored: [...flashRestores.keys()],
    smokeRestored: [...smokeRestores.keys()],
    lookRestored,
    lookMissing,
    journal: [...entries.values()],
  };
}
