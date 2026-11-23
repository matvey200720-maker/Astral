import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_WEAPON_RETICLES,
  STOCK_WEAPON_DAMAGE,
  damageForWeapon,
  damageStyleTable,
  isAstralReticleStyle,
  isOrdinaryReticleStyle,
  parseReticleStyleName,
  reticleStyleName,
  weaponReticleSlots,
} from "@modovik/reticle-contract";
import { STUDIO_TRACER_WEAPONS, tracerWeaponSource } from "@modovik/tracer-contract";

/*
 * Прицел на ствол — файлы оружия игры (задача 4 ТЗ 07.10.2026).
 *
 * Свой рисунок ствол получает своим стилем: `<ReticuleStyleHash>` в его
 * описании меняется на `ASTRAL_RETICLE_<номер>__<штатный стиль>`
 * (`@modovik/reticle-contract/weapons.js`), а hud_reticle.gfx того же пакета
 * узнаёт хеш этого имени. Где описан ствол — как у трассеров
 * (`tracerWeaponSource`): базовые — `common/data/ai/weapons.meta` в
 * update.rpf, стволы дополнений — файл пакета, который игра читает из
 * `update.rpf/dlc_patch/<пакет>/…`. Нет его там — он берётся из самого
 * пакета и кладётся в dlc_patch новым (строчными буквами: игра ищет записи
 * архива строчными).
 *
 * Файл правится текстом: меняется только значение одного поля в блоке
 * ствола, остальное — байт в байт как в игре (там могут быть правки
 * трассеров, вспышек и чужих модов оружия).
 *
 * Снять. Ствол, у которого в игре имя стиля Astral, а в наборе его больше
 * нет, получает штатный стиль из самого имени. Поэтому при правке ищутся
 * все файлы оружия update.rpf, а не только файлы стволов набора, — но
 * только когда есть что ставить или в игре стоит прицел с рисунками стволов
 * (`needsScan`): остальным установкам прицела файлы оружия не нужны вовсе.
 *
 * Счётчик урона (30.10.2026). Прицел видит только хеш стиля, а стиль один на
 * целый класс стволов. Поэтому при включённом счётчике своё имя получает
 * каждый ствол, у которого стиль — обычный прицел (`damageCounterWeapons`,
 * `reticleStyleName` со стволом): у кого нет своего рисунка — с номером 0. Число
 * берётся из выбранной таблицы сервера, а в режиме «Как в файлах игры» — из тех
 * же блоков. Ствол, файл которого не прочитался или заменён, и стволы сверх
 * потолка идут значением по штатному стилю: счётчик не повод отказать в установке
 * прицела. Не прочитался ни один файл (`damageUnread`) — все стволы идут так же,
 * если своих рисунков нет. Оптику игра берёт у насадки, поэтому снайперкам своё
 * имя ни к чему (`DAMAGE_STYLE_SOURCE`).
 */

const WEAPON_METAS_QUERY = "common/data/ai/";
const WEAPON_META =
  /^(?:dlc_patch\/[a-z0-9_]+\/)?common\/data\/ai\/[^/]*weapon[^/]*\.meta$/i;
const NOT_WEAPON_INFO = /(component|animation|archetype)/i;
const ITEM_OPEN = /<Item\s+type\s*=\s*"CWeaponInfo"\s*>/gi;
const NAME = /<Name>\s*([A-Za-z0-9_]+)\s*<\/Name>/;
const STYLE = /<ReticuleStyleHash>([^<]*)<\/ReticuleStyleHash>|<ReticuleStyleHash\s*\/>/;

const DAMAGE = /<Damage\s+value\s*=\s*"\s*(-?[0-9.]+)/;
const PLAYER_MODIFIER = /<NetworkPlayerDamageModifier\s+value\s*=\s*"\s*(-?[0-9.]+)/;
const HUD_DAMAGE = /<HudDamage\s+value\s*=\s*"\s*(-?[0-9.]+)/;
const SNIPER_GROUP = "Снайперские";

/**
 * Есть ли в hud_reticle.gfx игры свои имена стволов прошлой установки: рисунки
 * или счётчик урона.
 */
export const reticleHasWeaponLooks = (gfx) =>
  Buffer.isBuffer(gfx) &&
  (gfx.includes("astralBase", 0, "latin1") ||
    gfx.includes("astralDamageHit", 0, "latin1"));

/** Стволы, которым счётчик урона даёт своё имя: всё из мастерской, кроме оптики. */
export const damageCounterWeapons = () =>
  STUDIO_TRACER_WEAPONS.filter((weapon) => weapon.group !== SNIPER_GROUP).map(
    (weapon) => weapon.id,
  );

/** Это файл описаний оружия? (а не насадок, анимаций или архетипов) */
export const isWeaponInfoEntry = (entry) =>
  WEAPON_META.test(String(entry || "")) &&
  !NOT_WEAPON_INFO.test(path.posix.basename(String(entry || "")));

/**
 * Стили прицела всех стволов файла: имя ствола → `{ style, at, length }`.
 * `at` и `length` — где в тексте лежит значение поля (или пустой элемент
 * целиком: `selfClosing`). Ствол без поля — `style: null`.
 */
export function readReticleStyles(text) {
  const source = String(text || "");
  const starts = [...source.matchAll(ITEM_OPEN)].map((match) => match.index);
  const result = new Map();
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : source.length;
    const block = source.slice(start, end);
    const name = NAME.exec(block)?.[1]?.toUpperCase();
    if (!name || result.has(name)) return;
    const field = STYLE.exec(block);
    if (!field) {
      result.set(name, { style: null, at: -1, length: 0 });
      return;
    }
    if (field[1] === undefined) {
      result.set(name, {
        style: "",
        at: start + field.index,
        length: field[0].length,
        selfClosing: true,
      });
      return;
    }
    const valueAt = start + field.index + "<ReticuleStyleHash>".length;
    result.set(name, {
      style: field[1].trim(),
      at: valueAt,
      length: field[1].length,
    });
  });
  return result;
}

/**
 * Числа урона всех стволов файла: имя ствола → `{ damage, playerModifier, hud }`
 * (что из этого считать, решает `weaponInfoDamage` контракта).
 */
export function readWeaponDamage(text) {
  const source = String(text || "");
  const starts = [...source.matchAll(ITEM_OPEN)].map((match) => match.index);
  const result = new Map();
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : source.length;
    const block = source.slice(start, end);
    const name = NAME.exec(block)?.[1]?.toUpperCase();
    if (!name || result.has(name)) return;
    const number = (field) => Number(field.exec(block)?.[1]) || 0;
    result.set(name, {
      damage: number(DAMAGE),
      playerModifier: number(PLAYER_MODIFIER) || 1,
      hud: number(HUD_DAMAGE),
    });
  });
  return result;
}

/** Текст файла с новыми стилями стволов (`Map` ствол → имя стиля). */
export function writeReticleStyles(text, changes) {
  const source = String(text || "");
  const styles = readReticleStyles(source);
  const edits = [];
  for (const [weapon, style] of changes) {
    const found = styles.get(weapon);
    if (!found || found.at < 0)
      throw new Error(`В файле нет поля прицела у ${weapon}.`);
    edits.push({
      at: found.at,
      length: found.length,
      text: found.selfClosing
        ? `<ReticuleStyleHash>${style}</ReticuleStyleHash>`
        : style,
    });
  }
  edits.sort((left, right) => right.at - left.at);
  let result = source;
  for (const edit of edits)
    result =
      result.slice(0, edit.at) + edit.text + result.slice(edit.at + edit.length);
  return result;
}

/** Где описан ствол и куда класть правку: запись update.rpf и пакет. */
function weaponHome(id) {
  const source = tracerWeaponSource(id);
  if (!source) return null;
  if (source.kind === "base") return { entry: source.entry, pack: null };
  return {
    entry: source.patch,
    pack: { archive: source.archive, entry: source.packEntry },
  };
}

const lower = (value) => String(value || "").toLowerCase();

/**
 * Что сделать с файлами оружия: прочитанные файлы (`{ entry, text,
 * imported }`) и свои прицелы стволов (`{ WEAPON_X: настройки }`).
 *
 * Возвращает рисунки для компилятора (`styles`: настройки и стволы с именами
 * стилей), изменённые файлы, стволы, которым рисунок не встал, с причиной
 * (`skipped`), и стволы, которым вернулся штатный прицел (`restored`). При
 * включённом счётчике урона (`damage`) — ещё его таблицу (`damageTable`) и
 * стволы, которые идут значением по штатному стилю (`damageByStyle`).
 */
export function planReticleWeapons({ files, weapons, damage = null }) {
  const read = files.map((file) => ({
    ...file,
    styles: readReticleStyles(file.text),
    changes: new Map(),
  }));
  const byEntry = new Map(read.map((file) => [lower(file.entry), file]));
  const skipped = [];
  const accepted = {};
  const originals = new Map();
  for (const [weapon, config] of Object.entries(weapons || {})) {
    const home = weaponHome(weapon);
    const file = home && byEntry.get(lower(home.entry));
    const found = file?.styles.get(weapon);
    if (!home) {
      skipped.push({ weapon, reason: "ствола нет в списке мастерской" });
      continue;
    }
    if (!found) {
      skipped.push({
        weapon,
        reason: `в ${home.entry} нет этого ствола — файл, скорее всего, заменён модом оружия`,
      });
      continue;
    }
    if (found.style === null) {
      skipped.push({ weapon, reason: "у ствола нет поля прицела" });
      continue;
    }
    const original = isAstralReticleStyle(found.style)
      ? parseReticleStyleName(found.style)?.original
      : found.style.toUpperCase();
    if (!original || !isOrdinaryReticleStyle(original)) {
      skipped.push({
        weapon,
        reason: `у ствола свой прицел игры (${found.style || "пусто"}) — рисунок обычного прицела на него не встаёт`,
      });
      continue;
    }
    accepted[weapon] = config;
    originals.set(weapon, { file, original });
  }

  const counter = damage?.enabled ? damage : null;
  const { slots, slotOf } = weaponReticleSlots(accepted);
  const styles = slots.map((config) => ({ config, bindings: [], weapons: [] }));
  for (const [weapon, { file, original }] of originals) {
    const slot = slotOf.get(weapon);
    const name = reticleStyleName(slot, original, counter ? weapon : null);
    styles[slot - 1].bindings.push({ weapon, name });
    styles[slot - 1].weapons.push(weapon);
    if (file.styles.get(weapon).style.toUpperCase() !== name)
      file.changes.set(weapon, name);
  }
  /* Рисунок, все стволы которого с одним штатным стилем, одно имя: два
     ствола одного рисунка и одного стиля делят имя — у компилятора оно
     одно. */
  for (const style of styles) {
    const seen = new Set();
    style.bindings = style.bindings.filter((binding) => {
      if (seen.has(binding.name)) return false;
      seen.add(binding.name);
      return true;
    });
  }

  const damagePlan = counter
    ? planWeaponDamage({ read, byEntry, counter, slotOf, originals })
    : null;

  const restored = [];
  for (const file of read)
    for (const [weapon, found] of file.styles) {
      if (Object.hasOwn(accepted, weapon) || damagePlan?.named.has(weapon))
        continue;
      if (!found.style || !isAstralReticleStyle(found.style)) continue;
      const original =
        parseReticleStyleName(found.style)?.original || "WEAPON_PISTOL";
      file.changes.set(weapon, original);
      restored.push({ weapon, style: original });
    }

  const changed = read
    .filter((file) => file.changes.size)
    .map((file) => ({
      entry: file.entry,
      imported: Boolean(file.imported),
      text: writeReticleStyles(file.text, file.changes),
      weapons: [...file.changes.keys()],
    }));
  return {
    styles,
    files: changed,
    skipped,
    restored,
    damageTable: damagePlan?.table || null,
    damageByStyle: damagePlan?.byStyle || [],
  };
}

/*
 * Счётчик урона: свои имена стволам без рисунка и урон всех стволов. Потолок
 * общий с рисунками: они уже заняли своё в `originals`.
 */
function planWeaponDamage({ read, byEntry, counter, slotOf, originals }) {
  const stats = new Map();
  for (const file of read)
    for (const [weapon, info] of readWeaponDamage(file.text))
      if (!stats.has(weapon)) stats.set(weapon, info);
  const infoOf = (weapon) => stats.get(weapon) || null;
  const valueOf = (weapon) =>
    damageForWeapon(counter, weapon, infoOf(weapon) || STOCK_WEAPON_DAMAGE[weapon]);

  const own = [];
  const named = new Set();
  const byStyle = [];
  for (const [weapon, { original }] of originals) {
    named.add(weapon);
    own.push({
      name: reticleStyleName(slotOf.get(weapon), original, weapon),
      value: valueOf(weapon),
      alias: null,
    });
  }
  for (const weapon of damageCounterWeapons()) {
    if (named.has(weapon)) continue;
    const home = weaponHome(weapon);
    const file = home && byEntry.get(lower(home.entry));
    const found = file?.styles.get(weapon);
    const original =
      found?.style && isAstralReticleStyle(found.style)
        ? parseReticleStyleName(found.style)?.original
        : found?.style?.toUpperCase();
    if (
      !original ||
      !isOrdinaryReticleStyle(original) ||
      named.size >= MAX_WEAPON_RETICLES
    ) {
      byStyle.push(weapon);
      continue;
    }
    const name = reticleStyleName(0, original, weapon);
    named.add(weapon);
    own.push({ name, value: valueOf(weapon), alias: original });
    if (found.style.toUpperCase() !== name) file.changes.set(weapon, name);
  }
  const { styles, fallback } = damageStyleTable(counter, infoOf);
  return { table: { own, styles, fallback }, named, byStyle };
}

/*
 * Файлы оружия из игры: что нужно стволам набора и — если надо снимать —
 * все файлы оружия update.rpf. Одним поиском и одним извлечением на архив.
 */
async function readWeaponFiles(
  { gameRoot, weapons, optional = [], scanAll, staging },
  { searchArchive, extractMany },
) {
  const updateArchive = path.join(gameRoot, "update", "update.rpf");
  const request = { gameRoot, edition: "Legacy" };
  const listing = await searchArchive({
    ...request,
    archivePath: updateArchive,
    query: WEAPON_METAS_QUERY,
    maxMatches: 4000,
    /* Файлы оружия лежат папками, не во вложенных архивах. */
    maxNestedDepth: 0,
  });
  const present = new Map(
    (listing?.matches || [])
      .map((match) => String(match.entry || "").replaceAll("\\", "/"))
      .filter(isWeaponInfoEntry)
      .map((entry) => [lower(entry), entry]),
  );
  const fromUpdate = new Map();
  const fromPacks = new Map();
  if (scanAll) for (const [key, entry] of present) fromUpdate.set(key, entry);
  /* Файл стволов счётчика урона (`optional`) может и не прочитаться: они тогда
     идут значением по штатному стилю. Файл своего рисунка — обязан. */
  const required = new Set();
  const wanted = (weapon, mustRead) => {
    const home = weaponHome(weapon);
    if (!home) return;
    const key = lower(home.entry);
    if (present.has(key)) fromUpdate.set(key, present.get(key));
    else if (home.pack) {
      const list = fromPacks.get(home.pack.archive) || new Map();
      list.set(key, home);
      fromPacks.set(home.pack.archive, list);
      if (mustRead) required.add(home.pack.archive);
    }
  };
  for (const weapon of Object.keys(weapons)) wanted(weapon, true);
  for (const weapon of optional) wanted(weapon, false);

  const files = [];
  if (fromUpdate.size) {
    const output = path.join(staging, "update");
    const entries = [...fromUpdate.values()];
    await extractMany({
      ...request,
      archivePath: updateArchive,
      entries,
      outputDirectory: output,
    });
    for (const entry of entries)
      files.push({
        entry,
        imported: false,
        text: await fs.readFile(path.join(output, ...entry.split("/")), "latin1"),
      });
  }
  let pack = 0;
  for (const [archive, homes] of fromPacks) {
    pack += 1;
    const output = path.join(staging, `pack-${pack}`);
    const list = [...homes.values()];
    try {
      await extractMany({
        ...request,
        archivePath: path.join(gameRoot, ...archive.split("/")),
        entries: list.map((home) => home.pack.entry),
        outputDirectory: output,
      });
    } catch (error) {
      if (!required.has(archive)) continue;
      throw new Error(
        `В вашей игре не читается описание оружия из ${archive}: ${String(error?.message || error)}. Проверьте целостность файлов GTA V в Steam или Rockstar Launcher.`,
        { cause: error },
      );
    }
    for (const home of list) {
      const text = await fs
        .readFile(path.join(output, ...home.pack.entry.split("/")), "latin1")
        .catch((error) => {
          if (required.has(archive)) throw error;
          return null;
        });
      if (text === null) continue;
      files.push({
        /* Новая запись update.rpf — строчными: игра ищет записи так. */
        entry: lower(home.entry),
        imported: true,
        text,
      });
    }
  }
  return files;
}

/**
 * Файлы оружия для пакета прицела: читает игру, решает, пишет изменённые
 * файлы в `payloadDirectory` и возвращает рисунки для компилятора и
 * действия манифеста. `tools` — подмена поиска и извлечения в тестах.
 */
export async function resolveReticleWeapons(
  { gameRoot, weapons = {}, scanAll = false, staging, damage = null },
  { searchArchive, extractMany },
) {
  const counting = Boolean(damage?.enabled);
  const wanted = Object.keys(weapons).length > 0 || counting;
  if (!wanted && !scanAll)
    return { styles: [], files: [], skipped: [], restored: [] };
  const looks = Object.keys(weapons).length > 0;
  const files = await readWeaponFiles(
    {
      gameRoot,
      weapons,
      optional: counting ? damageCounterWeapons() : [],
      scanAll: scanAll || wanted,
      staging,
    },
    { searchArchive, extractMany },
  ).catch((error) => {
    /* Своим рисункам нужны файлы, счётчику — нет: он считает по стилям. */
    if (!counting || looks) throw error;
    return null;
  });
  return {
    ...planReticleWeapons({ files: files || [], weapons, damage }),
    damageUnread: files === null,
  };
}
