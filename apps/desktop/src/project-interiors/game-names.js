/*
 * «Интерьеры проектов» — какие модели и словари есть в самой игре игрока.
 *
 * Каталог интерьеров отличает «модель лежит в игре» от «модели нет нигде»:
 * вещи интерьера сервера в основном штатные пропсы Rockstar, и класть их в
 * мод незачем. Здесь — оглавление архивов игры: имена файлов `.ydr/.ydd/.yft`
 * (модели), `.ytd` (словари), `.ytyp` и `.ymap` — и ничего из их содержимого.
 *
 * Тот же порядок, что у оглавления подготовки наборов
 * (`scripts/lib/game-index.mjs`, в поставку не едет): базовые архивы,
 * `update.rpf` с правками дополнений, пакеты дополнений; архивы пакета,
 * которых он не монтирует, и свои контейнеры Astral (`x64/astral/…`,
 * `astral_*`) в оглавление не идут — модель мода не должна выдавать себя за
 * штатную.
 *
 * Оглавление держится в кэше Astral по отпечаткам архивов (размер и время
 * правки): второе открытие — без чтения архивов.
 *
 * Кроме «есть ли», оглавление говорит, ГДЕ лежит файл (`modelAt`, `sheetAt`):
 * кадр интерьера читает штатные пропсы из игры по этим адресам
 * (`архив:путь`, как у `createGameReader`). Порядок старшинства — как у игры:
 * правки дополнений (`dlc_patch`), дополнения, update.rpf, базовые архивы.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { openRpfFile } from "@modovik/rpf7/node";
import { joaat } from "./meta.js";

const INDEXED = /\.(ydr|yft|ytd|ydd|ytyp|ymap)$/i;
/* Меняется, когда меняется то, что попадает в оглавление: кэш строится заново. */
const INDEX_VERSION = 1;
const SKIPPED = /^(x64\/astral\/|redux\/)/i;
const PACK_LABEL = /^update\/x64\/dlcpacks\/([^/]+)\/dlc\.rpf$/;
const PATCH_CONTENT = /^dlc_patch\/([^/]+)\/content\.xml$/i;

/* Архивы, которые игра монтирует по `content.xml` пакета: `<filename>` записей, `%PLATFORM%` → `x64`. */
export function mountedArchives(contentXml) {
  const out = new Set();
  for (const match of String(contentXml || "").matchAll(/<filename>\s*([^<]+?)\s*<\/filename>/gi)) {
    const name = match[1].replace(/^[^:/]+:\//, "").replace(/%platform%/gi, "x64").toLowerCase();
    if (name.endsWith(".rpf")) out.add(name);
  }
  return out;
}

const nestedArchiveOf = (entry) => {
  const at = entry.indexOf(".rpf/");
  return at < 0 ? null : entry.slice(0, at + 4);
};

/* Записи, которые игра видит: архивы пакета, что он не монтирует, — мёртвый груз. */
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

/* Архивы игры в порядке старшинства; их же читает сборка бандла интерьеров (`scripts/lib/project-interiors-bundle.mjs`). */
export async function archivesOf(gameRoot) {
  const list = [];
  for (const name of (await fs.readdir(gameRoot)).sort())
    if (/^x64[a-z]?\.rpf$/i.test(name)) list.push({ label: name.toLowerCase(), file: path.join(gameRoot, name), rank: 0 });
  list.push({ label: "update", file: path.join(gameRoot, "update", "update.rpf"), rank: 1 });
  const packs = path.join(gameRoot, "update", "x64", "dlcpacks");
  for (const pack of (await fs.readdir(packs).catch(() => [])).sort()) {
    if (/^astral_/i.test(pack)) continue;
    const file = path.join(packs, pack, "dlc.rpf");
    if (await fs.stat(file).catch(() => null)) list.push({ label: `update/x64/dlcpacks/${pack.toLowerCase()}/dlc.rpf`, file, rank: 2 });
  }
  return list;
}

/*
 * Готовое оглавление живёт в памяти читателя недолго (26.10.2026, ТЗ п. C): каталог, сцена каждого зала казино и установка зовут его подряд,
 * а чтение 20 МБ кэша с диска и сборка таблиц стоит 0,3 с на каждый вызов (замер 26.10: холодное 2,8 с, тёплое 0,3 с). Отпечатки архивов
 * (размер и время правки, около сотни `stat`) проверяются каждый раз — обновили игру, и оглавление собирается заново.
 */
const MEMO_MS = 120_000;
let memo = null;

/**
 * Оглавление игры: `hasModel(хеш)`, `hasSheet(хеш)`, `hasName(имя файла
 * строчными)`; `stamp` — отпечаток архивов (другая игра — другой отпечаток).
 */
export async function openGameNames(gameRoot, { keys = null, cacheFile = null } = {}) {
  const archives = await archivesOf(gameRoot);
  const stamps = {};
  for (const archive of archives) {
    const stat = await fs.stat(archive.file);
    stamps[archive.label] = `${stat.size}:${Math.round(stat.mtimeMs)}`;
  }
  const memoKey = `${path.resolve(gameRoot).toLowerCase()}|${keys ? "keys" : "-"}|${archives.map((archive) => `${archive.label}:${stamps[archive.label]}`).join("|")}`;
  if (memo && memo.key === memoKey && Date.now() - memo.at < MEMO_MS) return memo.value;
  let cached = null;
  /* Кэш мог быть записан не до конца другим вызовом (каталог и сцена просят оглавление одновременно): обрезанный файл — не кэш, оглавление собирается заново, а не отказом «подключите GTA V». */
  if (cacheFile) cached = await fs.readFile(cacheFile, "utf8").then((text) => JSON.parse(text)).catch(() => null);
  const records = {};
  for (const archive of archives) {
    const known = cached?.version === INDEX_VERSION ? cached.archives?.[archive.label] : null;
    if (known && known.stamp === stamps[archive.label]) {
      records[archive.label] = known;
      continue;
    }
    const rpf = await openRpfFile(archive.file, { keys }).catch(() => null);
    const record = { stamp: stamps[archive.label], entries: [] };
    if (rpf) {
      for (const entry of rpf.entries) {
        const lower = entry.path.toLowerCase();
        /* Что монтирует пакет — его content.xml; правки dlc_patch — в update.rpf. */
        if (archive.rank === 2 && lower === "content.xml") record.mounted = [...mountedArchives(Buffer.from(await rpf.read(entry.path)).toString("utf8"))];
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
    /* Запись целиком или никак: рядом с кэшем — временный файл, потом переименование, чтобы чужое чтение не застало обрезанный кэш. */
    const temporary = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
    await fs
      .writeFile(temporary, JSON.stringify({ version: INDEX_VERSION, archives: records }))
      .then(() => fs.rename(temporary, cacheFile))
      .catch(() => fs.rm(temporary, { force: true }).catch(() => {}));
  }
  const mountedByPack = new Map();
  for (const archive of archives) {
    const pack = PACK_LABEL.exec(archive.label)?.[1];
    if (pack && records[archive.label].mounted) mountedByPack.set(pack, new Set(records[archive.label].mounted));
  }
  for (const [pack, list] of Object.entries(records.update?.patched || {})) mountedByPack.set(pack, new Set(list));

  const models = new Map();
  const sheets = new Map();
  const names = new Set();
  const put = (map, hash, weight, at) => {
    const known = map.get(hash);
    if (!known || weight >= known.weight) map.set(hash, { weight, at });
  };
  archives.forEach((archive, order) => {
    for (const entry of activeEntries(archive.label, records[archive.label].entries, mountedByPack)) {
      const name = entry.slice(entry.lastIndexOf("/") + 1);
      names.add(name);
      const kind = /\.(ydr|ydd|yft)$/.test(name) ? models : name.endsWith(".ytd") ? sheets : null;
      if (!kind) continue;
      const patched = archive.rank === 1 && entry.startsWith("dlc_patch/");
      const weight = patched ? 4000 : archive.rank === 2 ? 2000 + order : archive.rank === 1 ? 1000 : order;
      put(kind, joaat(name.replace(/\.[^.]+$/, "")), weight, `${archive.label}:${entry}`);
    }
  });
  const value = {
    hasModel: (hash) => models.has(hash),
    hasSheet: (hash) => sheets.has(hash),
    hasName: (name) => names.has(String(name).toLowerCase()),
    /** Адрес штатной модели или словаря по хешу имени (`архив:путь`) или `null`. */
    modelAt: (hash) => models.get(hash)?.at || null,
    sheetAt: (hash) => sheets.get(hash)?.at || null,
    stamp: archives.map((archive) => `${archive.label}:${stamps[archive.label]}`).join("|"),
  };
  memo = { key: memoKey, at: Date.now(), value };
  setTimeout(() => {
    if (memo?.value === value) memo = null;
  }, MEMO_MS).unref?.();
  return value;
}

/** Для тестов: забыть готовое оглавление. */
export function forgetGameNames() {
  memo = null;
}
