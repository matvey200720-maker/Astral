/*
 * Перепись текстур карты у игрока — для «Ухудшения текстур» на всю карту
 * (задача 1 ТЗ 05.10.2026).
 *
 * Мод `retexture.rpf` заменяет две тысячи словарей по своему списку; карта
 * же — около двадцати тысяч словарей: город, загород, земля, дороги,
 * здания, предметы (`levels/gta5/props`), интерьеры, общие словари
 * (`generic/gtxd.rpf`: дороги, лес, ночные огни) и дальние планы — `_lod`,
 * `slod1…3`, `+hi`. Список берётся не из описи, а из архивов игры игрока:
 * у разных сборок игры он разный.
 *
 * Карта — всё, что лежит под `levels/` (так игра раскладывает мир), кроме
 * машин (`vehicles.rpf`, `vehiclemods`), и трава `textures/plantsmgr.ytd`.
 *
 * Текстуры карты живут не только в словарях: модели (`.ydr`, `.ydd`,
 * `.yft`) часто несут свой словарь внутри — стены обсерватории, вывески,
 * предметы. Такие модели входят в перепись наравне со словарями (что
 * внутри — узнаёт хост при сборке: модель без своих текстур в ступень не
 * идёт).
 *
 * У одного имени бывает несколько файлов: в базовом архиве, в update.rpf,
 * в пакетах дополнений Rockstar и в контейнерах работ Astral. Игра берёт
 * последний смонтированный, и ступень собирается из него же — иначе вместе
 * с мылом вернулся бы прежний вид: старый словарь вместо обновлённого
 * пакетом или штатный вместо перекрашенного Мегамолла. Старшинство:
 *
 *   базовый архив < контейнер работы Astral в update.rpf < пакет
 *   дополнения (по `order` из его setup2.xml) < правка пакета в update.rpf
 *   (`dlc_patch/<пакет>/…`).
 *
 * Пакет считается, только если он включён в dlclist.xml. Пакеты Astral в
 * источники не идут: растительность собирается поверх ступени сама, а
 * прежние слои оптимизации (`astral_opt_*`) ступень и заменяет. Кроме
 * названных в `sources`: ступень мылит дороги в их новом цвете — пакеты
 * дорог (`astral_roads`, `astral_roads_b`, задача 6 ТЗ 07.10.2026) лежат
 * ниже неё и для неё источник, а сами дороги собираются из игры без себя. Файлы
 * пакета мест (`astral_places`) — выше ступени, их в ступень не берут.
 *
 * Машины и оружие (`vehicles`, `weapons`; задача 35 (б), 19.10.2026): «Стиль
 * мира», ЧБ-мир и «Ухудшение» берут и их. Машины — словари `.ytd` (базовые
 * `levels/gta5/vehicles.rpf`, дополнения `levels/gta5/vehicles/<пакет>.rpf`
 * и детали `levels/gta5/vehiclemods/<…>_mods.rpf`): модели машин (`.yft`) в
 * перепись не идут — встроенных текстур у них почти нет (меняется один файл из
 * 2 725, а читать они заставляют 3,4 ГиБ). Оружие — словари и модели `.ydr`
 * `models/cdimages/weapons.rpf` (в базе, дополнениях и `dlc_patch`). Имена у
 * тех и других глобально уникальны (у людей — нет: `mp_m_freemode_01_p/…` и
 * `mp_f_freemode_01_p/…` с одним и тем же именем), поэтому плоский пакет их
 * держит. Оружие берётся, только пока у игрока нет Astral Weapons DLC
 * (скины и стволы мастерской, `order` 100 — ниже пакетов текстур, 105+): иначе
 * копия штатного ствола из ступени перекрыла бы его скин и модель.
 *
 * Только чтение: архивы открываются и закрываются, оглавление — 1–2 с.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { openRpfFile } from "@modovik/rpf7/node";
import { fingerprintSha256 } from "@modovik/install-engine/file-fingerprint.js";

const YTD = /\.ytd$/i;
const MODEL = /\.(?:ydr|ydd|yft)$/i;
const VEHICLES = /(?:^|\/)vehicles\.rpf\/|vehiclemods|(?:^|\/)levels\/gta5\/vehicles\//i;
const PLANTS = /(?:^|\/)textures\/plantsmgr\.ytd$/i;
/* Машины: словари базы, дополнений и деталей. */
const VEHICLE_DICTIONARY = /(?:^|\/)levels\/[^/]+\/(?:vehicles\.rpf|vehicles\/[^/]+\.rpf|vehiclemods\/[^/]+\.rpf)\/[^/]+\.ytd$/i;
/* Оружие: словари и модели `weapons.rpf` (в базе, в дополнениях и в `dlc_patch/<пакет>/…`). */
const WEAPON_RESOURCE = /(?:^|\/)models\/cdimages\/weapons\.rpf\/[^/]+\.(?:ytd|ydr)$/i;
/* Пакет оружия мастерской: его файлы — штатные имена, но ниже пакетов ступени. */
const WEAPONS_DLC = "astral_weapons";
/* Прежние слои оптимизации и свои пакеты — не источники. */
const OWN_OPTIMIZATION = /^x64\/astral\/astral_opt_[a-z0-9_]+\.rpf\//;
const ASTRAL_CONTAINER = /^x64\/astral\/(astral_[a-z0-9_]+)\.rpf\/([^/]+\.(?:ytd|ydr|ydd|yft))$/;
const DLC_PATCH = /^dlc_patch\/([a-z0-9_]+)\/(.+)$/;

/** Словарь карты по пути внутри архива (строчными). */
export function isMapDictionary(entryPath) {
  const lower = String(entryPath || "").toLowerCase();
  if (!YTD.test(lower)) return false;
  if (PLANTS.test(lower)) return true;
  if (!/(?:^|\/)levels\//.test(lower)) return false;
  return !VEHICLES.test(lower);
}

/** Модель карты (со своими текстурами внутри или без) по пути внутри архива. */
export function isMapModel(entryPath) {
  const lower = String(entryPath || "").toLowerCase();
  if (!MODEL.test(lower) || !/(?:^|\/)levels\//.test(lower)) return false;
  return !VEHICLES.test(lower);
}

const isMapResource = (entryPath) => isMapDictionary(entryPath) || isMapModel(entryPath);

/** Машина или оружие по пути внутри архива (`vehicle`/`weapon`); остальное — `null`. */
export function gearGroupOf(entryPath) {
  const lower = String(entryPath || "").toLowerCase();
  if (VEHICLE_DICTIONARY.test(lower)) return "vehicle";
  if (WEAPON_RESOURCE.test(lower)) return "weapon";
  return null;
}

/** Пакеты, включённые в dlclist.xml: имена строчными. */
export function enabledDlcPacks(dlclistXml) {
  const names = new Set();
  for (const match of String(dlclistXml || "").matchAll(/<Item>\s*(?:dlcpacks:|platform:\/dlcpacks)\/?([^/<\s]+)\/?\s*<\/Item>/gi))
    names.add(match[1].toLowerCase());
  return names;
}

/** `order` пакета из setup2.xml (нет — 0). */
export function dlcOrder(setupXml) {
  const match = /<order\s+value="(\d+)"/i.exec(String(setupXml || ""));
  return match ? Number(match[1]) : 0;
}

const leafOf = (entry) => String(entry).split("/").pop().toLowerCase();

async function statIdentity(file) {
  const stat = await fs.stat(file).catch(() => null);
  return stat ? `${stat.size}:${Math.trunc(stat.mtimeMs)}` : "";
}

/**
 * Память хэшей записей update.rpf в JSON-файле (2b): `load(identity)` отдаёт их, пока отпечаток
 * архива тот же; `save(identity, hashes)` пишет атомарно — временный файл и переименование.
 */
export function jsonHashMemo(file) {
  return {
    async load(identity) {
      const value = await fs.readFile(file, "utf8").then(JSON.parse).catch(() => null);
      return value?.identity === identity && value.hashes && typeof value.hashes === "object" ? new Map(Object.entries(value.hashes)) : null;
    },
    async save(identity, hashes) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ identity, hashes: Object.fromEntries(hashes) }));
      await fs.rename(temporary, file);
    },
  };
}

/**
 * Перепись: `{ items: [{ name, kind, at, size, identity, rank }], packs, stats }`;
 * `kind` — `dictionary` (`.ytd`) или `model` (`.ydr`/`.ydd`/`.yft`).
 * `at` — место для нативного хоста (`x64m.rpf:levels/…`, `update:…`,
 * `update/x64/dlcpacks/<пакет>/dlc.rpf:…`), `identity` — по чему понять,
 * что словарь сменился (архив игры: размер и время; update.rpf, который
 * Astral переписывает на каждой установке, — отпечаток самих байт записи).
 * `pristine` — перепись без наших правок: без контейнеров работ Astral в
 * update.rpf и без вычеркивания файлов, которые несёт пакет мест. Нужна
 * описям (`prepare-roads.mjs`): они строятся по штатной игре, как она у игрока
 * без наших работ, а не по игре владельца с установленными местами.
 */
export async function censusMapTextures({
  gameRoot,
  keys,
  open = openRpfFile,
  sources = [],
  pristine = false,
  vehicles = false,
  weapons = false,
  /* Оружие считать и тогда, когда пакет оружия мастерской (`astral_weapons`) зарегистрирован: так его читает перепись победителей имён для режима
     «оружие через update.rpf» (`weapon-route-census.js`) — свой хост в переписи не участвует (свои пакеты — не источники), а без этого флага у человека
     с готовым хостом перепись была пуста и маршрут молча не срабатывал (находка 20.11.2026). «Стиль мира» флаг не ставит: ему хост по-прежнему мешает. */
  hostedWeapons = false,
  hashMemo = null,
  /* Готовые отпечатки записей update.rpf (путь → 32 знака SHA-256 байт записи): их считает движок вместе с оглавлением
     (`game-archive-listing.js`). С ними записи не читаются, а отпечаток самого архива не нужен. */
  updateHashes = null,
}) {
  const best = new Map();
  const consider = (item) => {
    const current = best.get(item.name);
    if (!current || item.rank >= current.rank) best.set(item.name, item);
  };
  const stats = { base: 0, update: 0, astral: 0, dlc: 0, packs: 0 };
  const kindOf = (name) => (YTD.test(name) ? "dictionary" : "model");
  /* Любые словари (не только карты), которые игра берёт не из базовых
     архивов: из update.rpf и пакетов дополнений. Файл мода поверх такого
     имени откатил бы обновлённый словарь (`texture-levels.js`). */
  const overridden = new Set();

  /* update.rpf: список пакетов, их правки и контейнеры работ Astral. */
  const updatePath = path.join(gameRoot, "update", "update.rpf");
  const update = await open(updatePath, { keys });
  let enabled;
  let wanted = isMapResource;
  const updateItems = [];
  try {
    enabled = enabledDlcPacks(Buffer.from(await update.read("common/data/dlclist.xml")).toString("utf8"));
    /* Оружие — пока нет пакета оружия мастерской (см. шапку файла). */
    wanted = (entryPath) => {
      if (isMapResource(entryPath)) return true;
      const group = gearGroupOf(entryPath);
      return group === "vehicle" ? vehicles : group === "weapon" ? weapons && (hostedWeapons || !enabled.has(WEAPONS_DLC)) : false;
    };
    for (const entry of update.entries) {
      if (entry.kind === "directory") continue;
      const lower = entry.path.toLowerCase();
      if (OWN_OPTIMIZATION.test(lower)) continue;
      if (YTD.test(lower) && !lower.startsWith("x64/astral/")) overridden.add(leafOf(lower));
      const container = ASTRAL_CONTAINER.exec(lower);
      if (container) {
        updateItems.push({ entry, lower, kind: "astral" });
        continue;
      }
      if (!wanted(lower)) continue;
      const patch = DLC_PATCH.exec(lower);
      updateItems.push({ entry, lower, kind: patch ? "patch" : "update", pack: patch?.[1] || null });
    }
    /* Байты записей update.rpf — их отпечаток: архив переписывается целиком
       на каждой установке, и время его правки ничего не говорит о словаре. */
    /* Память хэшей (`hashMemo`): пока отпечаток update.rpf тот же, его записи уже хэшированы — читать их заново не нужно. */
    const identity = hashMemo && !updateHashes ? await fingerprintSha256(updatePath).catch(() => null) : null;
    const remembered = identity ? await hashMemo.load(identity) : null;
    const hashes = new Map();
    for (const item of updateItems) {
      item.hash =
        updateHashes?.get(item.entry.path) ??
        remembered?.get(item.entry.path) ??
        createHash("sha256").update(Buffer.from(await update.read(item.entry.path))).digest("hex").slice(0, 32);
      hashes.set(item.entry.path, item.hash);
    }
    if (identity && (!remembered || remembered.size !== hashes.size)) await hashMemo.save(identity, hashes).catch(() => {});
  } finally {
    await update.close?.().catch(() => {});
  }

  /* Пакеты дополнений: свои (update/x64/dlcpacks) и старые в x64w.rpf. */
  const orders = new Map();
  const dlcRoot = path.join(gameRoot, "update", "x64", "dlcpacks");
  for (const folder of await fs.readdir(dlcRoot, { withFileTypes: true }).catch(() => [])) {
    if (!folder.isDirectory()) continue;
    const name = folder.name.toLowerCase();
    const own = name.startsWith("astral_");
    if ((own && !sources.includes(name)) || !enabled.has(name)) continue;
    const file = path.join(dlcRoot, folder.name, "dlc.rpf");
    const identity = await statIdentity(file);
    if (!identity) continue;
    const archive = await open(file, { keys }).catch(() => null);
    if (!archive) continue;
    try {
      const setup = archive.entries.find((entry) => entry.path.toLowerCase() === "setup2.xml");
      const order = setup ? dlcOrder(Buffer.from(await archive.read(setup.path)).toString("utf8")) : 0;
      orders.set(name, order);
      stats.packs += 1;
      const label = `update/x64/dlcpacks/${folder.name}/dlc.rpf`;
      for (const entry of archive.entries) {
        if (entry.kind === "directory") continue;
        if (YTD.test(entry.path)) overridden.add(leafOf(entry.path));
        /* У своего пакета словари лежат в потоковых архивах без `levels/`; пакеты дорог везут и модели со встроенными листами (ТЗ 17.10.2026, вечер): ступень текстур берёт их перекрашенными. */
        if (own ? !/^astral_[a-z0-9_]+\.rpf\/[^/]+\.(?:ytd|ydr|ydd|yft)$/i.test(entry.path) : !wanted(entry.path)) continue;
        consider({ name: leafOf(entry.path), kind: kindOf(entry.path), at: `${label}:${entry.path}`, size: Number(entry.storedSize || 0), identity, rank: 100 + order, source: "dlc" });
        stats.dlc += 1;
      }
    } finally {
      await archive.close?.().catch(() => {});
    }
  }

  /* Базовые архивы x64a…x64w; в x64w — ещё и первые пакеты дополнений. */
  const names = (await fs.readdir(gameRoot)).filter((name) => /^x64[a-z]\.rpf$/i.test(name)).sort();
  for (const label of names) {
    const file = path.join(gameRoot, label);
    const identity = await statIdentity(file);
    const archive = await open(file, { keys });
    try {
      const packOf = (lower) => /^dlcpacks\/([a-z0-9_]+)\/dlc\.rpf\/(.+)$/.exec(lower);
      /* Сначала порядки пакетов архива: их словари идут в оглавлении вперемешку. */
      for (const entry of archive.entries) {
        const pack = entry.kind === "directory" ? null : packOf(entry.path.toLowerCase());
        if (pack && pack[2] === "setup2.xml" && enabled.has(pack[1]))
          orders.set(pack[1], dlcOrder(Buffer.from(await archive.read(entry.path)).toString("utf8")));
      }
      for (const entry of archive.entries) {
        if (entry.kind === "directory") continue;
        const lower = entry.path.toLowerCase();
        const pack = packOf(lower);
        if (pack) {
          if (!enabled.has(pack[1])) continue;
          if (YTD.test(pack[2])) overridden.add(leafOf(lower));
          if (!wanted(pack[2])) continue;
          consider({ name: leafOf(lower), kind: kindOf(lower), at: `${label}:${entry.path}`, size: Number(entry.storedSize || 0), identity, rank: 100 + (orders.get(pack[1]) || 0), source: "dlc" });
          stats.dlc += 1;
          continue;
        }
        if (!wanted(lower)) continue;
        consider({ name: leafOf(lower), kind: kindOf(lower), at: `${label}:${entry.path}`, size: Number(entry.storedSize || 0), identity, rank: 0, source: "base" });
        stats.base += 1;
      }
    } finally {
      await archive.close?.().catch(() => {});
    }
  }

  /* Записи update.rpf — после пакетов: их старшинство зависит от порядка
     пакета. Контейнеры работ Astral — последними: из них берутся только
     словари карты (перекрашенные стены, вода, фонари) и свои копии дальних
     планов (`astral_youtool_cs4_02_lod`), но не свои картинки вроде радуги. */
  const order = { patch: 0, update: 0, astral: 1 };
  for (const item of [...updateItems].sort((a, b) => order[a.kind] - order[b.kind])) {
    const name = leafOf(item.lower);
    const at = `update:${item.entry.path}`;
    const size = Number(item.entry.storedSize || 0);
    const kind = kindOf(name);
    if (item.kind === "astral") {
      if (pristine) continue;
      /* Модель работы — только поверх модели карты: свои новые модели
         (плашки, звезда арены) — рисунок владельца, не карта. */
      if (!best.has(name) && (kind === "model" || !/^astral_[a-z0-9_]*lod/.test(name))) continue;
      consider({ name, kind, at, size, identity: item.hash, rank: 50, source: "astral" });
      stats.astral += 1;
    } else if (item.kind === "patch") {
      if (!enabled.has(item.pack)) continue;
      consider({ name, kind, at, size, identity: item.hash, rank: 100 + (orders.get(item.pack) || 0) + 0.5, source: "update" });
      stats.update += 1;
    } else {
      consider({ name, kind, at, size, identity: item.hash, rank: 25, source: "update" });
      stats.update += 1;
    }
  }

  /* Места мастерской — свой пакет выше ступени (`astral_places`, 107 > 105,
     фикс 1 ТЗ 06.10.2026): их файлы игра берёт у места, копия в ступени
     была бы мёртвым грузом. */
  const places = path.join(dlcRoot, "astral_places", "dlc.rpf");
  if (!pristine && enabled.has("astral_places") && (await statIdentity(places))) {
    const archive = await open(places, { keys }).catch(() => null);
    try {
      for (const entry of archive?.entries || [])
        if (entry.kind !== "directory" && /^astral_[a-z0-9_]+\.rpf\/[^/]+\.(?:ytd|ydr|ydd|yft)$/i.test(entry.path)) best.delete(leafOf(entry.path));
    } finally {
      await archive?.close?.().catch(() => {});
    }
  }

  /* Контейнер работы Astral поверх словаря, который карта и так знает, — да;
     свои новые имена (изолированные дальние планы зданий) — тоже: игра
     берёт их вместо штатных. */
  const items = [...best.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const models = items.filter((item) => item.kind === "model").length;
  return { items, packs: Object.fromEntries(orders), overridden, stats: { ...stats, dictionaries: items.length - models, models } };
}
