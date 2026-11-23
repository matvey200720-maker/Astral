/*
 * Имена файлов, которые штатные пакеты игры включают наборами `GROUP_MAP` (26.10.2026, «последние 22 файла дорог»).
 *
 * Сетевая карта (GTA Online, Majestic, GTA 5 RP) — это пакеты Rockstar (`mpheist`, `mpapartment`, `mplowrider`, `mpchristmas2017`…), чьи
 * архивы игра включает только на входе в сетевую карту, наборами изменений группы `GROUP_MAP`, и включает позже наших пакетов на старте.
 * Свой файл с таким же именем в части нашего пакета на сетевой карте проигрывает: игра берёт штатный из архива `GROUP_MAP`. Правило «по
 * префиксу `hei_`» (12.10.2026) знало только районы ограблений `mpheist`; у дорог так же перебиваются ещё 22 файла без префикса
 * (`apa_*` апартаментов, `lr_*` лоурайдеров, `xm_*` Рождества, `xm3_*`, `ch_*`, `m24_*`, `m26_*`, `reh_*`, `tr_*`), у растительности — словари крон и
 * травяные карты `apa_ch2_*_grass_*.ymap` (проверено 26.10.2026 на игре владельца: все 128 имён, перебиваемых и с `hei_`, и без, лежат ТОЛЬКО в архивах
 * `GROUP_MAP` — в базе, в `update.rpf` вне `dlc_patch` и в прочих пакетах их нет).
 *
 * Как игра включает файлы (разобрано на настоящих файлах):
 *   • `update.rpf:common/data/dlclist.xml` — пакеты дополнений по порядку;
 *   • группы пакета — `setup2.xml` его `dlc.rpf` (в `dlc_patch` его нет): `contentChangeSetGroups` → `GROUP_MAP` → имена наборов;
 *   • наборы — `content.xml` (`update.rpf:dlc_patch/<пакет>/content.xml` главнее): `filesToEnable` — и верхнего уровня, и внутри
 *     `mapChangeSetData/Item` (у `mpheist` почти все районы лежат там);
 *   • файл набора — архив `.rpf` внутри `dlc.rpf` пакета (`%PLATFORM%` = `x64`) или, если он есть, одноимённый в `update.rpf:dlc_patch/<пакет>/…`
 *     (главнее); имена — записи первого уровня этого архива.
 *
 * Здесь читается только игра игрока и только на чтение. Весь проход по 104 пакетам — около десяти секунд, а ещё столько же — проверка «имя есть и вне
 * GROUP_MAP» (база `x64*.rpf`, `update.rpf` вне `dlc_patch`, архивы пакетов вне наборов `GROUP_MAP`): такое имя штатный сюжет читает из другого архива, и
 * убирать наш файл из частей нельзя. Поэтому результат — только имена, которые лежат **исключительно** в архивах `GROUP_MAP`, и только из списка
 * кандидатов (имена, которые вправе писать дороги или растительность). Он кладётся в кэш по отпечатку игры — размер и время `update.rpf` и каждого
 * `dlc*.rpf` пакетов, без чтения: повторная сборка стоит миллисекунды. Читает рабочий поток сборки (`roads-build-host-worker.js`,
 * `vegetation-build-host-worker.js`); нет ключей ArchiveFix или архив не открылся — ответ `null`, и вызывающий остаётся на правиле `hei_`.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { openRpfFile } from "@modovik/rpf7/node";

/** Версия разбора: поменялась — кэш прежних отпечатков не годится. */
export const GAME_MAP_NAMES_VERSION = 1;

const lower = (value) => String(value ?? "").toLowerCase();
const slashes = (value) => String(value ?? "").split(String.fromCharCode(92)).join("/");
const blocks = (xml, tag) => [...String(xml ?? "").matchAll(new RegExp(`<${tag}>([^]*?)</${tag}>`, "gi"))].map((match) => match[1]);
const items = (xml) => blocks(xml, "Item").map((item) => item.trim()).filter(Boolean);
const text = (bytes) => Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, "");

/** Пакеты из `dlclist.xml` по порядку: `platform:/dlcPacks/mpBeach/` и `dlcpacks:/mpheist/`. */
export function dlcListPacks(xml) {
  const packs = [];
  for (const match of String(xml ?? "").matchAll(/<Item>\s*(?:platform:\/dlcpacks|dlcpacks:)\/([^/<]+)\/?\s*<\/Item>/gi)) packs.push(match[1].trim());
  return packs;
}

/** Группы пакета из `setup2.xml`: `Map<имя группы, [имена наборов]>`. */
export function setupGroups(xml) {
  const groups = new Map();
  for (const block of blocks(xml, "contentChangeSetGroups")) {
    for (const chunk of block.split(/(?=<NameHash>)/i)) {
      const name = (/<NameHash>\s*([^<]*?)\s*<\/NameHash>/i.exec(chunk) || [])[1];
      if (!name) continue;
      const sets = items(blocks(chunk, "ContentChangeSets")[0] || "");
      groups.set(name, [...(groups.get(name) || []), ...sets]);
    }
  }
  return groups;
}

/** Наборы изменений из `content.xml`: `Map<имя набора, [строки filesToEnable]>` — и верхнего уровня, и из `mapChangeSetData`. */
export function contentChangeSets(xml) {
  const sets = new Map();
  for (const block of blocks(xml, "contentChangeSets")) {
    for (const chunk of block.split(/(?=<changeSetName>)/i)) {
      const name = (/<changeSetName>\s*([^<]*?)\s*<\/changeSetName>/i.exec(chunk) || [])[1];
      if (!name) continue;
      const files = blocks(chunk, "filesToEnable").flatMap((part) => items(part));
      sets.set(name, [...(sets.get(name) || []), ...files]);
    }
  }
  return sets;
}

/** Путь архива набора внутри пакета: без устройства (`dlc_mpApartment:/`), `%PLATFORM%` → `x64`, строчные, косые вперёд; не `.rpf` — `""`. */
export function packArchivePath(filename) {
  const value = lower(slashes(filename)).replace(/^[^:/]+:\//, "").replace(/%platform%/g, "x64").replace(/^\/+/, "");
  return value.endsWith(".rpf") ? value : "";
}

/** Записи первого уровня архива `archive` в списке записей `entries`: строчные имена файлов (не папок). */
function childNames(entries, archive) {
  const prefix = `${archive}/`;
  const names = [];
  for (const entry of entries) {
    if (entry.kind === "directory") continue;
    const entryPath = lower(entry.path);
    if (!entryPath.startsWith(prefix)) continue;
    const rest = entryPath.slice(prefix.length);
    if (rest && !rest.includes("/")) names.push(rest);
  }
  return names;
}

/**
 * Один проход по игре: `{ mapNames, outside, packs, mapArchives }`. `mapNames` — все имена архивов `GROUP_MAP`, `outside` — те из `candidates`,
 * что нашлись и вне этих архивов. `open(file, options)` — читатель архивов (`openRpfFile`), подменяется в тестах.
 */
export async function scanGameMapNames({ gameRoot, keys, candidates, open = openRpfFile, exists = defaultExists, onStep = null }) {
  const wanted = new Set([...candidates].map(lower));
  const outside = new Set();
  const mapNames = new Set();
  const root = slashes(gameRoot);
  const updateFile = path.join(root, "update", "update.rpf");
  const update = await open(updateFile, { keys });
  try {
    const patch = new Map();
    for (const entry of update.entries) {
      const entryPath = lower(entry.path);
      if (entryPath.startsWith("dlc_patch/")) patch.set(entryPath, entry);
      else if (entry.kind !== "directory" && wanted.has(entryPath.slice(entryPath.lastIndexOf("/") + 1))) outside.add(entryPath.slice(entryPath.lastIndexOf("/") + 1));
    }
    const read = async (archive, entryPath) => {
      const entry = archive.entries.find((item) => lower(item.path) === entryPath);
      return entry ? text(await archive.read(entry.path)) : "";
    };
    const dlcList = await read(update, "common/data/dlclist.xml");
    const packs = dlcListPacks(dlcList);
    const mapArchives = [];
    let done = 0;
    for (const pack of packs) {
      const key = lower(pack);
      const folders = [path.join(root, "update", "x64", "dlcpacks", pack), path.join(root, "x64", "dlcpacks", pack)];
      const files = [];
      for (const folder of folders) {
        for (const name of ["dlc.rpf", "dlc1.rpf", "dlc2.rpf"]) {
          const file = path.join(folder, name);
          if (await exists(file)) files.push(file);
        }
        if (files.length) break;
      }
      const archives = [];
      try {
        for (const file of files) archives.push(await open(file, { keys }).catch(() => null));
        const live = archives.filter(Boolean);
        const readPack = async (entryPath) => {
          for (const archive of live) {
            const found = await read(archive, entryPath);
            if (found) return found;
          }
          return "";
        };
        const patchRead = async (entryPath) => {
          const entry = patch.get(`dlc_patch/${key}/${entryPath}`);
          return entry ? text(await update.read(entry.path)) : "";
        };
        const content = (await patchRead("content.xml")) || (await readPack("content.xml"));
        const setup = (await patchRead("setup2.xml")) || (await readPack("setup2.xml"));
        const groupSets = new Set(setupGroups(setup).get("GROUP_MAP") || []);
        const sets = contentChangeSets(content);
        const archivePaths = new Set();
        for (const set of groupSets) for (const filename of sets.get(set) || []) {
          const archive = packArchivePath(filename);
          if (archive) archivePaths.add(archive);
        }
        const patchEntries = [...patch.entries()].filter(([entryPath]) => entryPath.startsWith(`dlc_patch/${key}/`)).map(([, entry]) => ({ ...entry, path: lower(entry.path).slice(`dlc_patch/${key}/`.length) }));
        const mapped = new Set();
        for (const archive of archivePaths) {
          const inPatch = patchEntries.some((entry) => entry.path === archive);
          const names = inPatch ? childNames(patchEntries, archive) : live.flatMap((item) => childNames(item.entries, archive));
          mapArchives.push({ pack, archive, where: inPatch ? "dlc_patch" : "dlc.rpf", count: names.length });
          for (const name of names) mapNames.add(name);
          mapped.add(archive);
        }
        /* Вне GROUP_MAP: записи пакета и его патча, что не лежат в архивах наборов `GROUP_MAP`. */
        const insideMap = (entryPath) => [...mapped].some((archive) => entryPath.startsWith(`${archive}/`));
        for (const entry of [...live.flatMap((item) => item.entries), ...patchEntries]) {
          if (entry.kind === "directory") continue;
          const entryPath = lower(entry.path);
          const name = entryPath.slice(entryPath.lastIndexOf("/") + 1);
          if (wanted.has(name) && !insideMap(entryPath)) outside.add(name);
        }
      } finally {
        for (const archive of archives) await archive?.close?.().catch(() => {});
      }
      done += 1;
      onStep?.({ phase: "packs", done, total: packs.length });
    }
    return { mapNames, outside, packs: packs.length, mapArchives };
  } finally {
    await update.close?.().catch(() => {});
  }
}

const defaultExists = (file) => fs.stat(file).then(() => true, () => false);

/** База игры (`x64*.rpf` в корне): кандидаты, что лежат и в ней, — вне `GROUP_MAP`. */
export async function scanBaseNames({ gameRoot, keys, candidates, open = openRpfFile, list = (folder) => fs.readdir(folder) }) {
  const wanted = new Set([...candidates].map(lower));
  const found = new Set();
  const root = slashes(gameRoot);
  for (const file of (await list(root).catch(() => [])).filter((name) => /^x64[a-z]\.rpf$/i.test(name)).sort()) {
    const archive = await open(path.join(root, file), { keys }).catch(() => null);
    if (!archive) continue;
    try {
      for (const entry of archive.entries) {
        if (entry.kind === "directory") continue;
        const entryPath = lower(entry.path);
        const name = entryPath.slice(entryPath.lastIndexOf("/") + 1);
        if (wanted.has(name)) found.add(name);
      }
    } finally {
      await archive.close?.().catch(() => {});
    }
  }
  return found;
}

/** Отпечаток игры без чтения: размер и время `update.rpf` и каждого `dlc*.rpf` пакетов. */
export async function gameFingerprint(gameRoot, { stat = (file) => fs.stat(file), list = (folder) => fs.readdir(folder) } = {}) {
  const root = slashes(gameRoot);
  const parts = [`v${GAME_MAP_NAMES_VERSION}`];
  const one = async (file) => {
    const info = await stat(file).catch(() => null);
    parts.push(`${slashes(path.relative(root, file)).toLowerCase()}|${info ? `${info.size}|${Math.round(info.mtimeMs)}` : "-"}`);
  };
  await one(path.join(root, "update", "update.rpf"));
  for (const base of [path.join(root, "update", "x64", "dlcpacks"), path.join(root, "x64", "dlcpacks")]) {
    for (const pack of (await list(base).catch(() => [])).sort()) {
      for (const name of ["dlc.rpf", "dlc1.rpf", "dlc2.rpf"]) {
        const file = path.join(base, pack, name);
        if (await stat(file).then(() => true, () => false)) await one(file);
      }
    }
  }
  for (const name of (await list(root).catch(() => [])).filter((entry) => /^x64[a-z]\.rpf$/i.test(entry)).sort()) await one(path.join(root, name));
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

const candidatesDigest = (candidates) => createHash("sha256").update([...new Set([...candidates].map(lower))].sort().join("\n"), "utf8").digest("hex").slice(0, 16);

/**
 * Имена, которые игра включает только наборами `GROUP_MAP`, из списка `candidates`: `{ names: Set<строчные>, cached, packs, ms }`.
 * `null` — прочитать игру не вышло (нет ключей, нет `update.rpf`, архив не открылся): вызывающий остаётся на правиле `hei_`.
 * `stateDir` — папка состояния Astral: кэш лежит в `<stateDir>/recolor/map-names/`.
 */
export async function gameMapNames({ gameRoot, keys, candidates, stateDir = null, open = openRpfFile, log = null, now = () => Date.now(), onStep = null }) {
  if (!gameRoot || !keys || !candidates?.size) return null;
  const started = now();
  let fingerprint = "";
  try {
    fingerprint = await gameFingerprint(gameRoot);
  } catch (error) {
    log?.({ level: "warn", source: "map-names", message: `Отпечаток игры не снят: ${String(error?.message || error)}` });
    return null;
  }
  const cacheFile = stateDir ? path.join(stateDir, "recolor", "map-names", `${fingerprint.slice(0, 24)}-${candidatesDigest(candidates)}.json`) : null;
  if (cacheFile) {
    const kept = await fs.readFile(cacheFile, "utf8").then(JSON.parse).catch(() => null);
    if (kept?.version === GAME_MAP_NAMES_VERSION && kept.fingerprint === fingerprint && Array.isArray(kept.names))
      return { names: new Set(kept.names), cached: true, packs: kept.packs || 0, ms: now() - started };
  }
  try {
    const scanned = await scanGameMapNames({ gameRoot, keys, candidates, open, onStep });
    /* Правило «в `_mp` только то, что включает `GROUP_MAP`» держится на этом списке: игра без единого архива `GROUP_MAP` — это не «нет перекрытий», а разбор,
       что не сработал (другая раскладка файлов, чужая версия игры); пустой ответ убрал бы из `_mp` и районы `hei_`. Тогда — запасное правило `hei_`. */
    if (!scanned.mapArchives.length) throw new Error(`в ${scanned.packs} пакетах игры не нашлось ни одного архива GROUP_MAP`);
    const base = await scanBaseNames({ gameRoot, keys, candidates, open });
    const wanted = new Set([...candidates].map(lower));
    const names = [...scanned.mapNames].filter((name) => wanted.has(name) && !scanned.outside.has(name) && !base.has(name)).sort();
    if (cacheFile) {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      const temporary = `${cacheFile}.${process.pid}.${Math.round(now())}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ version: GAME_MAP_NAMES_VERSION, fingerprint, packs: scanned.packs, names }));
      await fs.rename(temporary, cacheFile).catch(() => fs.rm(temporary, { force: true }));
    }
    log?.({ level: "info", source: "map-names", message: `Имена GROUP_MAP из игры: ${names.length} из ${wanted.size} кандидатов, пакетов ${scanned.packs}, ${now() - started} мс.` });
    return { names: new Set(names), cached: false, packs: scanned.packs, ms: now() - started };
  } catch (error) {
    log?.({ level: "warn", source: "map-names", message: `Имена GROUP_MAP из игры не прочитаны, остаётся правило hei_: ${String(error?.message || error)}` });
    return null;
  }
}
