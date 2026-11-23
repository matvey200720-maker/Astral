/*
 * Где в игре лежит файл по имени — для скриптов подготовки наборов.
 *
 * Сцене 3D-кадра нужны адреса штатных листов («Стандарт» завода, соседи
 * мест): `x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_build3.ytd`.
 * Сами листы в поставку не попадают — их по адресу читает Astral Desktop из
 * игры игрока (`apps/desktop/src/workshop-textures.js`). Здесь только
 * оглавления архивов: какие модели и словари где лежат.
 *
 * Порядок, в котором игра берёт одноимённый файл: правки дополнений
 * (`update.rpf/dlc_patch/<пакет>`), сами дополнения, update.rpf, базовые
 * архивы. Свои контейнеры Astral (`x64/astral/…`) и чужие слои (`redux/…`)
 * пропускаются: адрес должен вести к файлу Rockstar, а не к моду.
 *
 * Архивы внутри пакета, которых пакет не монтирует, в оглавление не идут
 * (`mountedArchives`): игра их не читает, и адрес туда уводил правку мимо игры.
 *
 * Оглавление кэшируется по отпечаткам архивов (размер и время): повторный
 * прогон не открывает семь десятков архивов заново.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { openRpfFile } from "@modovik/rpf7/node";

const INDEXED = /\.(ydr|yft|ytd|ydd|ytyp|ymap)$/i;
/* Меняется, когда меняется то, что попадает в оглавление: кэш строится заново.
   3 — списки монтируемых архивов пакетов. */
const INDEX_VERSION = 3;
const SKIPPED = /^(x64\/astral\/|redux\/)/i;
const PACK_LABEL = /^update\/x64\/dlcpacks\/([^/]+)\/dlc\.rpf$/;
const PATCH_CONTENT = /^dlc_patch\/([^/]+)\/content\.xml$/i;

/*
 * Архивы внутри пакета, которые игра монтирует: `<filename>` записей его
 * content.xml — или правки `update.rpf:dlc_patch/<пакет>/content.xml`, она
 * главнее. Остальные пакет возит мёртвым грузом: patchday1ng везёт
 * `country_04_metadata.rpf`, patchday2ng — `sanpedro_metadata.rpf`, но не
 * монтирует их, и игра берёт типы и карты из x64t.rpf / x64?.rpf. Адрес в
 * такую копию уводил изоляцию LOD завода в файл, которого игра не видит
 * (07.10.2026).
 */
export function mountedArchives(contentXml) {
  const out = new Set();
  for (const match of String(contentXml || "").matchAll(/<filename>\s*([^<]+?)\s*<\/filename>/gi)) {
    const name = match[1]
      .replace(/^[^:/]+:\//, "")
      .replace(/%platform%/gi, "x64")
      .toLowerCase();
    if (name.endsWith(".rpf")) out.add(name);
  }
  return out;
}

/* Вложенный архив записи (`…/cs4_13.rpf/cs4_13_lod.ytd` → `…/cs4_13.rpf`) или `null`. */
function nestedArchiveOf(entry) {
  const at = entry.indexOf(".rpf/");
  return at < 0 ? null : entry.slice(0, at + 4);
}

/*
 * Записи, которые игра видит. Список монтируемых, где не нашлось ни одного
 * вложенного архива пакета, — чужой формат content.xml: тогда пакет целиком
 * считается живым, как раньше.
 */
export function activeEntries(label, entries, mountedByPack) {
  const pack = PACK_LABEL.exec(label)?.[1];
  if (pack) {
    const mounted = mountedByPack.get(pack);
    if (!mounted) return entries;
    const nested = new Set(entries.map(nestedArchiveOf).filter(Boolean));
    if (![...nested].some((archive) => mounted.has(archive))) return entries;
    return entries.filter((entry) => {
      const archive = nestedArchiveOf(entry);
      return !archive || mounted.has(archive);
    });
  }
  if (label !== "update") return entries;
  return entries.filter((entry) => {
    const patch = /^dlc_patch\/([^/]+)\/(.+)$/.exec(entry);
    if (!patch) return true;
    const mounted = mountedByPack.get(patch[1]);
    const archive = nestedArchiveOf(patch[2]);
    return !mounted || !archive || mounted.has(archive);
  });
}

async function archivesOf(gameRoot) {
  const list = [];
  for (const name of (await fs.readdir(gameRoot)).sort())
    if (/^x64[a-z]?\.rpf$/i.test(name)) list.push({ label: name.toLowerCase(), file: path.join(gameRoot, name), rank: 0 });
  list.push({ label: "update", file: path.join(gameRoot, "update", "update.rpf"), rank: 1 });
  const packs = path.join(gameRoot, "update", "x64", "dlcpacks");
  for (const pack of (await fs.readdir(packs).catch(() => [])).sort()) {
    if (/^astral_/i.test(pack)) continue;
    const file = path.join(packs, pack, "dlc.rpf");
    if (await fs.stat(file).catch(() => null))
      list.push({ label: `update/x64/dlcpacks/${pack.toLowerCase()}/dlc.rpf`, file, rank: 2 });
  }
  return list;
}

/**
 * Отпечатки архивов игры сейчас, `{ метка: "размер:время" }` — те же, по которым `openGameIndex` решает, что запись оглавления устарела. Движок сверяет с ними файл
 * оглавления (`world-place-engine.js`) и без устаревшего его не читает. Нет архива (`update.rpf`) — отказ, как у `openGameIndex`.
 */
export async function gameIndexStamps(gameRoot) {
  const stamps = {};
  for (const archive of await archivesOf(gameRoot)) {
    const stat = await fs.stat(archive.file);
    stamps[archive.label] = `${stat.size}:${Math.round(stat.mtimeMs)}`;
  }
  return stamps;
}

/**
 * Оглавление игры: `lookup(имя файла)` → адрес `архив:путь` или `null`,
 * `all(имя)` — все адреса по порядку старшинства.
 */
export async function openGameIndex(gameRoot, { keys, cacheFile = null, log = () => {} } = {}) {
  const archives = await archivesOf(gameRoot);
  const stamps = {};
  for (const archive of archives) {
    const stat = await fs.stat(archive.file);
    stamps[archive.label] = `${stat.size}:${Math.round(stat.mtimeMs)}`;
  }
  let cached = null;
  if (cacheFile) {
    try {
      cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    } catch {
      cached = null;
    }
  }
  const records = {};
  for (const archive of archives) {
    const known = cached?.version === INDEX_VERSION ? cached?.archives?.[archive.label] : null;
    if (known && known.stamp === stamps[archive.label]) {
      records[archive.label] = known;
      continue;
    }
    log(`Оглавление ${archive.label}…`);
    const rpf = await openRpfFile(archive.file, { keys }).catch(() => null);
    const record = { stamp: stamps[archive.label], entries: [] };
    if (rpf) {
      for (const entry of rpf.entries) {
        const lower = entry.path.toLowerCase();
        /* Что монтирует пакет — его content.xml; правки dlc_patch — в update.rpf. */
        if (archive.rank === 2 && lower === "content.xml")
          record.mounted = [...mountedArchives(Buffer.from(await rpf.read(entry.path)).toString("utf8"))];
        const patch = archive.rank === 1 ? PATCH_CONTENT.exec(lower) : null;
        if (patch) (record.patched ||= {})[patch[1]] = [...mountedArchives(Buffer.from(await rpf.read(entry.path)).toString("utf8"))];
        if (!INDEXED.test(entry.path) || SKIPPED.test(entry.path)) continue;
        record.entries.push(lower);
      }
      await rpf.close?.();
    }
    records[archive.label] = record;
  }
  if (cacheFile) {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify({ version: INDEX_VERSION, archives: records }));
  }
  const mountedByPack = new Map();
  for (const archive of archives) {
    const pack = PACK_LABEL.exec(archive.label)?.[1];
    if (pack && records[archive.label].mounted) mountedByPack.set(pack, new Set(records[archive.label].mounted));
  }
  for (const [pack, list] of Object.entries(records.update?.patched || {})) mountedByPack.set(pack, new Set(list));
  const byArchive = {};
  for (const archive of archives) byArchive[archive.label] = activeEntries(archive.label, records[archive.label].entries, mountedByPack);

  /* Старшинство: dlc_patch → дополнения (поздние выше) → update → база. */
  const locations = new Map();
  const add = (name, at, weight) => {
    const list = locations.get(name) || [];
    list.push({ at, weight });
    locations.set(name, list);
  };
  archives.forEach((archive, order) => {
    for (const entry of byArchive[archive.label] || []) {
      const name = entry.split("/").pop();
      const patched = archive.rank === 1 && entry.startsWith("dlc_patch/");
      const weight = patched ? 4000 : archive.rank === 2 ? 2000 + order : archive.rank === 1 ? 1000 : order;
      add(name, `${archive.label}:${entry}`, weight);
    }
  });
  for (const list of locations.values()) list.sort((a, b) => b.weight - a.weight);

  /* Чтение по адресу — архивы открываются по разу и только по делу. */
  const files = new Map(archives.map((archive) => [archive.label, archive.file]));
  const opened = new Map();
  const openArchive = (label) => {
    if (!opened.has(label)) {
      const file = files.get(label);
      opened.set(
        label,
        file
          ? openRpfFile(file, { keys }).then((rpf) => {
              rpf.byPath = new Map(rpf.entries.map((entry) => [entry.path.toLowerCase(), entry]));
              return rpf;
            })
          : Promise.resolve(null),
      );
    }
    return opened.get(label);
  };

  return {
    lookup: (name) => locations.get(String(name).toLowerCase())?.[0]?.at || null,
    all: (name) => (locations.get(String(name).toLowerCase()) || []).map((item) => item.at),
    /* Все имена файлов оглавления (строчными) — для поиска по хешу имени. */
    names: () => [...locations.keys()],
    /* Все адреса оглавления по порядку старшинства: архив за архивом. */
    entries: (filter = null) =>
      archives.flatMap((archive) =>
        (byArchive[archive.label] || []).filter((entry) => !filter || filter(entry)).map((entry) => `${archive.label}:${entry}`),
      ),
    async read(at) {
      const split = String(at).indexOf(":");
      const rpf = await openArchive(at.slice(0, split));
      const entry = rpf?.byPath.get(at.slice(split + 1).toLowerCase());
      return entry ? new Uint8Array(await rpf.read(entry.path)) : null;
    },
    async close() {
      for (const pending of opened.values()) await (await pending)?.close?.();
      opened.clear();
    },
  };
}
