/*
 * Длительность перезарядки стволов из файлов игры (владелец, 15.11.2026: «пусть оно всё считывается с реальных
 * файлов игры»). Разбор текстов: weapons.meta (CWeaponInfo: ReloadTimeSP/MP, AnimReloadRate), weaponanimations.meta
 * (ствол → наборы клипов по наборам анимаций: Default, Ballistic, FirstPerson…) и clip_sets.xml (набор → словарь).
 * Чтение архивов и сам расчёт — ниже в этом файле; формула — `weaponReloadMs` в `@modovik/reticle-contract`.
 * Только чтение: в папку игры ничего не пишется. Таблица «ствол → мс» вшивается в hud_reticle.gfx при установке
 * (`reticle-customizer.js`); `scripts/reload-times.mjs` печатает её же для сверки на стенде.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { openRpfFile } from "@modovik/rpf7/node";
import {
  normalizeReloadTimes,
  reloadTimeKey,
  reticleStyleHash,
  weaponReloadMs,
} from "@modovik/reticle-contract";
import {
  listClips,
  parseDictionary,
  readClip,
} from "./animations/ycd-graft.js";

/* Блок CWeaponInfo: до следующего такого же заголовка — внутри бывают вложенные <Item> (компоненты, эффекты). */
function itemBlocks(text, type) {
  const marks = [
    ...String(text).matchAll(new RegExp(`<Item\\s+type="${type}"\\s*>`, "gi")),
  ].map((match) => match.index);
  return marks.map((start, index) =>
    text.slice(start, marks[index + 1] ?? text.length),
  );
}

const numberField = (block, name) => {
  const match = new RegExp(`<${name}\\s+value="([^"]*)"\\s*/>`, "i").exec(
    block,
  );
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
};

/**
 * Числа перезарядки из weapons.meta: `Map(ИМЯ_СТВОЛА → { reloadTimeSP, reloadTimeMP, animReloadRate, clipSize })`.
 * Поля, которых в блоке нет, — `null`. Ствол дважды в одном файле — первый (так читает и счётчик урона).
 */
export function readWeaponReloadInfo(text) {
  const out = new Map();
  for (const block of itemBlocks(text, "CWeaponInfo")) {
    const name = /<Name>\s*([^<]+?)\s*<\/Name>/i
      .exec(block)?.[1]
      ?.toUpperCase();
    if (!name || out.has(name)) continue;
    out.set(name, {
      reloadTimeSP: numberField(block, "ReloadTimeSP"),
      reloadTimeMP: numberField(block, "ReloadTimeMP"),
      animReloadRate: numberField(block, "AnimReloadRate"),
      clipSize: numberField(block, "ClipSize"),
    });
  }
  return out;
}

/**
 * Наборы клипов стволов из weaponanimations.meta: `[{ set, fallback, weapon, fields }]`, `fields` — все поля ствола
 * с текстом (`WeaponClipSetHash` и пр.) и числами (`value="…"`).
 */
export function readWeaponAnimationSets(text) {
  const out = [];
  const source = String(text);
  const setOpen =
    /<Item\s+key="([^"]+)"\s*>\s*(?:<Fallback>\s*([^<]*?)\s*<\/Fallback>\s*|<Fallback\s*\/>\s*)?<WeaponAnimations>/gi;
  let set;
  while ((set = setOpen.exec(source))) {
    const from = setOpen.lastIndex;
    const close = source.indexOf("</WeaponAnimations>", from);
    const body = source.slice(from, close < 0 ? source.length : close);
    for (const weapon of body.matchAll(
      /<Item\s+key="([^"]+)"\s*>([\s\S]*?)<\/Item>/gi,
    )) {
      const fields = {};
      for (const field of weapon[2].matchAll(/<(\w+)>\s*([^<]*?)\s*<\/\1>/g))
        if (field[2]) fields[field[1]] = field[2];
      for (const field of weapon[2].matchAll(/<(\w+)\s+value="([^"]*)"\s*\/>/g))
        fields[field[1]] = field[2];
      out.push({
        set: set[1],
        fallback: set[2] || null,
        weapon: weapon[1].toUpperCase(),
        fields,
      });
    }
  }
  return out;
}

/** Наборы клипов из clip_sets.xml: `Map(набор строчными → { dictionary, fallback })`. */
export function readClipSets(text) {
  const out = new Map();
  for (const item of String(text).matchAll(
    /<Item\s+key="([^"]+)"\s+type="fwClipSet\w*"\s*>([\s\S]*?)<\/Item>/gi,
  )) {
    const dictionary =
      /<clipDictionaryName>\s*([^<]+?)\s*<\/clipDictionaryName>/i.exec(item[2]);
    const fallback = /<fallbackId>\s*([^<]+?)\s*<\/fallbackId>/i.exec(item[2]);
    out.set(item[1].toLowerCase(), {
      dictionary: dictionary?.[1]?.toLowerCase() || null,
      fallback: fallback?.[1]?.toLowerCase() || null,
    });
  }
  return out;
}

/* ------------------------------- расчёт ------------------------------- */

/** Имена клипа перезарядки в словаре набора ствола — по порядку; дальше — первый, что начинается с `reload_aim`. */
export const RELOAD_CLIP_NAMES = Object.freeze(["reload_aim", "reload"]);

/** Клип перезарядки из списка клипов словаря `[{ name, seconds, rate }]` (имена — короткие, строчными) или `null`. */
export function pickReloadClip(clips) {
  const list = Array.isArray(clips) ? clips : [];
  for (const name of RELOAD_CLIP_NAMES) {
    const found = list.find((clip) => clip.name === name);
    if (found) return found;
  }
  return list.find((clip) => /^reload_aim/.test(clip.name)) || null;
}

/**
 * Откуда число у ствола с клипом перезарядки — переключатель одной константой (владелец, 15.11.2026: «бери
 * информацию из файлов с игры»; число — от начала перезарядки до мига, когда снова можно стрелять):
 *   • `null` — длина клипа (по умолчанию);
 *   • хеш метки клипа (`readClipTags`), например `0x01e6effa` — у пистолета, помпового и карабина она стоит на
 *     фазе ≈ 0,93 — время начала этой метки в клипе: фаза × длина клипа. У клипа без такой метки — длина клипа.
 * Для сверки то же самое без правки кода — `scripts/reload-times.mjs --tag <хеш>`.
 */
export const RELOAD_TIME_TAG = null;

/* Метка-источник в клипе: первая с этим хешем и фазой начала внутри клипа, иначе `null`. */
function reloadTag(clip, tagHash) {
  if (tagHash === null) return null;
  return (
    (clip.tags || []).find(
      (tag) => tag.hash === tagHash && tag.start > 0 && tag.start <= 1,
    ) || null
  );
}

const hexHash = (hash) => `0x${hash.toString(16).padStart(8, "0")}`;

/* Набор анимаций ствола: «Default», иначе первый, где ствол есть. */
function animationFields(animations, weapon) {
  const own = animations.filter((item) => item.weapon === weapon);
  return (
    (own.find((item) => item.set.toLowerCase() === "default") || own[0])
      ?.fields || null
  );
}

/**
 * Таблица длительностей по собранным файлам игры. `files` — тексты в порядке игры (последний перекрывает):
 * `{ info: [текст], animations: [текст], clipSets: [текст] }`; `readClips(словарь)` — клипы словаря
 * `[{ name, seconds, rate }]` или `null`, если словаря нет. Ответ: `{ table, weapons, found, total }`, где
 * `weapons` — `[{ name, key, ms, source }]` по стволам с обоймой больше 1 (у прочих индикатор молчит).
 * `options.tag` — источник числа клипа вместо `RELOAD_TIME_TAG` (`null` — длина клипа, хеш — время метки).
 */
export async function computeReloadTimes(files, readClips, options = {}) {
  const chosen = options.tag === undefined ? RELOAD_TIME_TAG : options.tag;
  const tagHash = chosen === null ? null : Number(chosen) >>> 0;
  const info = new Map();
  for (const text of files.info || [])
    for (const [name, value] of readWeaponReloadInfo(text))
      info.set(name, value);
  const animations = new Map();
  for (const text of files.animations || [])
    for (const item of readWeaponAnimationSets(text))
      animations.set(`${item.set.toLowerCase()}|${item.weapon}`, item);
  const clipSets = new Map();
  for (const text of files.clipSets || [])
    for (const [name, value] of readClipSets(text)) clipSets.set(name, value);
  const animationList = [...animations.values()];
  const clipCache = new Map();
  const clipsOf = async (dictionary) => {
    if (!clipCache.has(dictionary))
      clipCache.set(
        dictionary,
        await readClips(dictionary).catch(() => ({ broken: true })),
      );
    return clipCache.get(dictionary);
  };

  const table = {};
  const weapons = [];
  const names = [...info.keys()]
    .filter((name) => /^WEAPON_/.test(name) && info.get(name).clipSize > 1)
    .sort();
  for (const name of names) {
    const numbers = info.get(name);
    const key = reloadTimeKey(reticleStyleHash(name));
    let ms = null;
    let source = null;
    if (numbers.reloadTimeSP > 0) {
      ms = weaponReloadMs(numbers, null);
      source = `weapons.meta ReloadTimeSP ${numbers.reloadTimeSP}`;
    } else {
      const fields = animationFields(animationList, name);
      const sets = [
        fields?.WeaponClipSetHash,
        fields?.WeaponClipSetStreamedHash,
      ]
        .filter(Boolean)
        .map((set) => set.toLowerCase());
      if (!sets.length) source = "в weaponanimations.meta нет набора клипов";
      for (const set of sets) {
        const dictionary = clipSets.get(set)?.dictionary || set;
        const clips = await clipsOf(dictionary);
        if (!clips || clips.broken) {
          source ??= clips
            ? `словарь ${dictionary} не разобрался`
            : `нет словаря ${dictionary}`;
          continue;
        }
        const clip = pickReloadClip(clips);
        if (!clip) {
          source = `в ${dictionary} нет клипа перезарядки`;
          continue;
        }
        const tag = reloadTag(clip, tagHash);
        ms = weaponReloadMs(
          numbers,
          tag ? { ...clip, seconds: tag.start * clip.seconds } : clip,
        );
        const rate =
          numbers.animReloadRate > 0 && numbers.animReloadRate !== 1
            ? ` / AnimReloadRate ${numbers.animReloadRate}`
            : "";
        source = tag
          ? `${dictionary}/${clip.name} метка ${hexHash(tagHash)} на фазе ${tag.start.toFixed(3)} = ${(tag.start * clip.seconds).toFixed(3)} с из ${clip.seconds.toFixed(3)} с${rate}`
          : `${dictionary}/${clip.name} ${clip.seconds.toFixed(3)} с${rate}${tagHash === null ? "" : ` — метки ${hexHash(tagHash)} нет, длина клипа`}`;
        if (ms === null) source += " — вне пределов";
        break;
      }
    }
    if (ms !== null) table[key] = ms;
    weapons.push({ name, key, ms, source });
  }
  const result = {
    table: normalizeReloadTimes(table),
    weapons,
    found: Object.keys(table).length,
    total: weapons.length,
  };
  if (options.details)
    result.details = await reloadClipDetails(
      animationList,
      clipSets,
      clipsOf,
      options.details,
    );
  return result;
}

/*
 * Для сверки (`scripts/reload-times.mjs --clips`): у названных стволов — все наборы клипов из всех наборов
 * анимаций (поля `…ClipSetHash`, `…ClipSetStreamedHash`) и в каждом словаре — клипы `reload*` с длиной, скоростью и
 * метками по фазам. В таблицу не идёт: только показать, где в клипе игра пополняет обойму.
 */
async function reloadClipDetails(animationList, clipSets, clipsOf, weapons) {
  const wanted = new Set(
    [...weapons].map((name) => String(name).toUpperCase()),
  );
  const out = [];
  for (const item of animationList) {
    if (!wanted.has(item.weapon)) continue;
    for (const [field, value] of Object.entries(item.fields)) {
      if (!/ClipSet(Streamed)?Hash$/.test(field) || !value) continue;
      const set = value.toLowerCase();
      const dictionary = clipSets.get(set)?.dictionary || set;
      const clips = await clipsOf(dictionary);
      out.push({
        weapon: item.weapon,
        set: item.set,
        field,
        dictionary,
        clips:
          clips && !clips.broken
            ? clips.filter((clip) => /^reload/.test(clip.name))
            : null,
        missing: !clips ? "нет словаря" : clips.broken ? "не разобрался" : null,
      });
    }
  }
  return out;
}

/* -------------------------------- чтение -------------------------------- */

const WEAPON_INFO = /(?:^|\/)(?:common\/)?data\/ai\/[^/]*weapon[^/]*\.meta$/i;
const NOT_INFO = /(component|animation|archetype)/i;
const ANIMATIONS = /(?:^|\/)weaponanimations[^/]*\.meta$/i;
const CLIP_SETS = /(?:^|\/)clip_sets[^/]*\.xml$/i;

/**
 * Архивы игры в порядке, в каком игра их грузит, — последний перекрывает: common.rpf и x64c.rpf (клипы
 * `anim/ingame/clip_*.rpf`), дополнения `update/x64/dlcpacks/<пак>/dlc.rpf`, последним `update/update.rpf`
 * (заплатка: `common/data/ai/…` и `dlc_patch/<пак>/…`; ганпаки Astral пишут weapons.meta сюда же). Папку
 * `mods/` Astral паркует (`clearModsShadow`), её игра не грузит.
 */
export async function reloadArchives(gameRoot) {
  const list = [
    path.join(gameRoot, "common.rpf"),
    path.join(gameRoot, "x64c.rpf"),
  ];
  const packs = path.join(gameRoot, "update", "x64", "dlcpacks");
  const names = (
    await fs.readdir(packs, { withFileTypes: true }).catch(() => [])
  )
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  for (const name of names) list.push(path.join(packs, name, "dlc.rpf"));
  list.push(path.join(gameRoot, "update", "update.rpf"));
  return list;
}

/* `dlc_patch/<пак>/…` в update.rpf перекрывает сам пак, а `common/data/ai/…` update.rpf — основу: заплатку — после. */
const patchRank = (entryPath) => (/^dlc_patch\//i.test(entryPath) ? 1 : 0);

/* ------------------------------ метки клипа ------------------------------ */

/*
 * Метки клипа (`ClipTagList`, устройство — CodeWalker `Clip.cs`): у клипа указатель на список на 0x38; список — массив
 * указателей и число; метка — имя-хеш на 0x18, атрибуты (указатели и число на 0x20/0x28), фазы начала и конца на
 * 0x40/0x44; атрибут — вид на 0x08, имя-хеш на 0x18, значение на 0x20. Указатели — в системную область (0x50000000).
 * Кривые данные меток не роняют разбор: меток просто нет.
 */
const SYSTEM_BASE = 0x5000_0000;
const CLIP_TAGS = 0x38;
const MAX_TAGS = 256;
const MAX_ATTRIBUTES = 32;
const ATTRIBUTE_KIND = Object.freeze({
  1: "float",
  2: "int",
  3: "bool",
  4: "string",
  6: "vector3",
  8: "vector4",
  12: "hash",
});

/* joaat без перевода в строчные: так хеширует имена CodeWalker (`XmlMeta.GetHash`); строчными — `reticleStyleHash`. */
function exactHash(text) {
  let hash = 0;
  for (const byte of Buffer.from(String(text), "utf8")) {
    hash = (hash + byte) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  return (hash + (hash << 15)) >>> 0;
}

/* Имена меток и атрибутов, которые встречаются в клипах игры, — чтобы печатать слова, а не хеши (оба написания хеша). */
export const CLIP_TAG_NAMES = Object.freeze(
  new Map(
    [
      "Audio",
      "Object",
      "Foot",
      "Flash",
      "Visible",
      "MoveEvent",
      "Interruptible",
      "WalkInterruptible",
      "BlendOutWithDuration",
      "BlendOut",
      "BlendIn",
      "ArmsIk",
      "LegsIk",
      "LookIk",
      "LookIkControl",
      "Facial",
      "SelectiveFaceAnim",
      "MotionBlur",
      "CameraShake",
      "Door",
      "ApplyForce",
      "BlockRagdoll",
      "SwitchToRagdoll",
      "Projectile",
      "Fire",
      "Create",
      "Release",
      "Destroy",
      "Shell",
      "Clip",
      "Weapon",
      "Reload",
      "ReloadEvent",
      "BlockReload",
      "Ammo",
      "Event",
      "Name",
      "Id",
      "Hand",
      "Left",
      "Right",
      "Start",
      "Stop",
      "Value",
      "Duration",
      "Phase",
      "Attach",
      "Detach",
      "Mag",
      "Magazine",
      "Prop",
      "Hold",
      "Sound",
      "Vfx",
      "Ik",
      "Mover",
      "Gesture",
      "Interrupt",
      "Bone",
      "BoneId",
      "Tag",
      "Type",
      "Enabled",
      "Rate",
    ].flatMap((name) => [
      [exactHash(name), name],
      [reticleStyleHash(name) >>> 0, name],
    ]),
  ),
);

function systemPointer(sys, at) {
  if (at < 0 || at + 8 > sys.length) return null;
  const low = sys.readUInt32LE(at);
  const high = sys.readUInt32LE(at + 4);
  if (high !== 0 || low < SYSTEM_BASE || low - SYSTEM_BASE >= sys.length)
    return null;
  return low - SYSTEM_BASE;
}

const fits = (sys, at, size) =>
  at !== null && at >= 0 && at + size <= sys.length;

function attributeValue(sys, at, kind, names) {
  if (!fits(sys, at, 0x30)) return null;
  if (kind === 1) return sys.readFloatLE(at + 0x20);
  if (kind === 2) return sys.readInt32LE(at + 0x20);
  if (kind === 3) return sys.readUInt32LE(at + 0x20) !== 0;
  if (kind === 12) {
    const hash = sys.readUInt32LE(at + 0x20);
    return names.get(hash) ?? `0x${hash.toString(16).padStart(8, "0")}`;
  }
  if (kind === 4) {
    const text = systemPointer(sys, at + 0x20);
    const length = sys.readUInt16LE(at + 0x28);
    return fits(sys, text, length)
      ? sys.toString("latin1", text, text + length)
      : null;
  }
  return null;
}

/**
 * Метки клипа разобранного словаря (`parseDictionary`, клип из `listClips`): `[{ name, hash, start, end, attributes }]`
 * по возрастанию фазы начала; `name` — слово из `CLIP_TAG_NAMES` или `null`, `start`/`end` — фазы 0…1,
 * `attributes` — `[{ name, hash, kind, value }]`.
 */
export function readClipTags(dictionary, clip, names = CLIP_TAG_NAMES) {
  const sys = dictionary?.sys;
  if (!Buffer.isBuffer(sys) || !fits(sys, clip?.at ?? null, 0x48)) return [];
  const list = systemPointer(sys, clip.at + CLIP_TAGS);
  if (!fits(sys, list, 0x20)) return [];
  const array = systemPointer(sys, list);
  const count = Math.min(sys.readUInt16LE(list + 8), MAX_TAGS);
  if (!fits(sys, array, count * 8)) return [];
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const tag = systemPointer(sys, array + index * 8);
    if (!fits(sys, tag, 0x50)) continue;
    const hash = sys.readUInt32LE(tag + 0x18);
    const attributesAt = systemPointer(sys, tag + 0x20);
    const attributeCount = Math.min(
      sys.readUInt16LE(tag + 0x28),
      MAX_ATTRIBUTES,
    );
    const attributes = [];
    if (fits(sys, attributesAt, attributeCount * 8))
      for (let slot = 0; slot < attributeCount; slot += 1) {
        const at = systemPointer(sys, attributesAt + slot * 8);
        if (!fits(sys, at, 0x20)) continue;
        const kind = sys[at + 8];
        const name = sys.readUInt32LE(at + 0x18);
        attributes.push({
          name: names.get(name) ?? null,
          hash: name,
          kind: ATTRIBUTE_KIND[kind] || kind,
          value: attributeValue(sys, at, kind, names),
        });
      }
    out.push({
      name: names.get(hash) ?? null,
      hash,
      start: sys.readFloatLE(tag + 0x40),
      end: sys.readFloatLE(tag + 0x44),
      attributes,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Длительности перезарядки всех стволов из файлов игры (`computeReloadTimes`). Только чтение: архивы
 * открываются и закрываются. `keys` — ключи архивов (`keysFromDirectory`), `open` — для тестов, `tag` — источник
 * числа клипа (`RELOAD_TIME_TAG`). Ответ — как у `computeReloadTimes`, плюс `archives` (сколько открылось) и
 * `unread` (какие не открылись).
 */
export async function resolveReloadTimes(
  { gameRoot, keys },
  { open = openRpfFile, details = null, tag = RELOAD_TIME_TAG } = {},
) {
  const files = { info: [], animations: [], clipSets: [] };
  const dictionaries = new Map(); // словарь строчными -> { file, path }
  const unread = [];
  let archives = 0;
  for (const file of await reloadArchives(gameRoot)) {
    let archive;
    try {
      archive = await open(file, { keys });
    } catch (error) {
      if (error?.code !== "ENOENT")
        unread.push(
          `${path.relative(gameRoot, file)}: ${error?.code || error?.message || error}`,
        );
      continue;
    }
    archives += 1;
    try {
      const found = { info: [], animations: [], clipSets: [] };
      for (const entry of archive.entries) {
        if (entry.kind === "directory") continue;
        const lowered = entry.path.toLowerCase();
        if (lowered.endsWith(".ycd")) {
          dictionaries.set(path.posix.basename(lowered, ".ycd"), {
            file,
            path: entry.path,
          });
          continue;
        }
        const kind =
          WEAPON_INFO.test(lowered) &&
          !NOT_INFO.test(path.posix.basename(lowered))
            ? "info"
            : ANIMATIONS.test(lowered)
              ? "animations"
              : CLIP_SETS.test(lowered)
                ? "clipSets"
                : null;
        if (kind) found[kind].push(entry);
      }
      for (const kind of Object.keys(found))
        for (const entry of found[kind].sort(
          (a, b) => patchRank(a.path) - patchRank(b.path),
        ))
          files[kind].push(
            Buffer.from(await archive.read(entry.path)).toString("latin1"),
          );
    } finally {
      await archive.close?.();
    }
  }
  const opened = new Map();
  const readClips = async (dictionary) => {
    const place = dictionaries.get(dictionary);
    if (!place) return null;
    if (!opened.has(place.file))
      opened.set(place.file, open(place.file, { keys }));
    const archive = await opened.get(place.file);
    const parsed = parseDictionary(Buffer.from(await archive.read(place.path)));
    return listClips(parsed).map((clip) => {
      const read = readClip(parsed, clip);
      return {
        name: clip.short || String(clip.name || "").toLowerCase(),
        seconds: read.duration,
        rate: read.entries[0]?.rate ?? 1,
        tags: readClipTags(parsed, clip),
      };
    });
  };
  try {
    const result = await computeReloadTimes(files, readClips, { details, tag });
    return { ...result, archives, unread };
  } finally {
    for (const pending of opened.values())
      await Promise.resolve(pending).then(
        (archive) => archive.close?.(),
        () => {},
      );
  }
}

/* Одна таблица на копию игры, пока её архивы не менялись: установка прицела не читает игру заново каждый раз. */
let remembered = null;

async function gameSignature(gameRoot) {
  const parts = [];
  for (const file of await reloadArchives(gameRoot)) {
    const stat = await fs.stat(file).catch(() => null);
    parts.push(stat ? `${file}|${stat.size}|${stat.mtimeMs}` : `${file}|-`);
  }
  return parts.join("\n");
}

/** `resolveReloadTimes` с памятью по подписи архивов (размер и время изменения). */
export async function reloadTimesForGame({ gameRoot, keys }, tools = {}) {
  const tag = tools.tag === undefined ? RELOAD_TIME_TAG : tools.tag;
  const signature = `${tag}\n${await gameSignature(gameRoot)}`;
  if (remembered?.signature === signature) return remembered.result;
  const result = await resolveReloadTimes({ gameRoot, keys }, tools);
  if (!result.unread.length) remembered = { signature, result };
  return result;
}
