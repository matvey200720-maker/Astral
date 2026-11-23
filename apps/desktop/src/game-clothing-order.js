/*
 * Сквозные номера вещей самой игры (задача 2 ТЗ 06.10.2026).
 *
 * Проекты зовут вещь GTA Online сквозным номером — тем же, что у игры:
 * «Кроссовки скейтерские» GTA5RP — обувь №7, жилет фракций 01.2016 — №17.
 * Номер складывается так: вещи базы игры, затем коллекции дополнений в
 * порядке их загрузки, у каждой — столько номеров, сколько вещей в её
 * раскладке (`@modovik/clothing/ped-variation`). Отсюда и обратное: по
 * номеру проекта — папка и файл вещи в игре игрока, куда ставить заменёнку.
 *
 * Как устроено в игре (проверено по файлам игры владельца 06.10.2026):
 *   • порядок дополнений для сквозных номеров — НЕ позиция в `dlclist.xml`, а `<order>` и `<minorOrder>` из `setup2.xml` пака (у `update.rpf/dlc_patch/<пак>/setup2.xml`
 *     старшинство); ПАКИ ИЗ `x64w.rpf` (ранние: mpBeach…spUpgrade) идут ПЕРВЫМИ, раньше всех паков update, каждая группа — по своему `<order>`/`<minorOrder>`, при равных значениях — по месту в `dlclist.xml`
 *     (четвёртый заход, кадры 15.11: жен. низ 16 — beach №0, 18 — christmas №0 (по `dlclist.xml` стоял бы business, по общему `setup2.xml` — xmas2 из `mppatchesng`, order 0, делящего его с `mpbeach`),
 *     30 — lts №0; муж. маска 18 — hipster №1). Пятый заход (15.11, 07:23–07:32, 33 контроля без установки, `verdict-fifth.md`): жен. низ 16–31 (beach, christmas, valentines, business, hipster, independence,
 *     pilot, lts, `xmas2` №0 = 31), муж. обувь 16–24 и муж. маски 8, 11, 14, 17, 21, 27, 28, 31 по началам коллекций — все 33 сошлись: порядок «ранние паки блоком, каждый по своему `setup2.xml`» доказан игрой на трёх
 *     компонентах, и пометка `unconfirmed` с ранних паков снята. Она остаётся там, где порядок игрой не проверялся: ничья `<order>`/`<minorOrder>` между паками одной группы (кто первый — решало место в
 *     `dlclist.xml`) и пак без `setup2.xml` или без `<order>` (update — он и всё после него): такой номер адресатом не отдаётся (на игре владельца таких паков нет). Ошибка 06.10
 *     держалась до третьего захода стенда 15.11.2026: проверенные вещи (броня №17, начала hipster и luxe_01) стоят там, где оба порядка дают один номер. В третьем заходе
 *     jbib 169, prop 90 и lowr 42 по `dlclist.xml` вели на `importexport_01` №12, `bikerdlc` p_head №0 и `xmas2` lowr 0, а в игре оказались синяя джинсовая куртка (`bikerdlc` №12,
 *     лист a — синий деним), серая каска с оранжевым ремешком (`bikerdlc` p_head №7) и «ног нет» (`female_heist` lowr №10, чёрная упряжь): по `setup2.xml` на этих номерах именно они;
 *     в 32 соседних парах `dlclist.xml` порядок `<order>` убывает. Список дополнений — `update.rpf/common/data/dlclist.xml`; ранние
 *     (mpBeach…mpLTS) лежат в `x64w.rpf/dlcpacks`, остальные — в `update/x64/dlcpacks`;
 *   • коллекция — по имени `dlcName` её раскладки: патчи добавляют вещи в
 *     коллекцию под своей папкой (`mp_m_heist_01` патча 5 — это та же
 *     коллекция, что `male_heist`), раскладка берётся последняя;
 *   • в новой игре одежда части дополнений (`battle`, `heist4`, `tuner`,
 *     `security`) переехала в паки-патчи, но номер у коллекции — по месту
 *     её дополнения (`mp<суффикс>` из списка), как у серверов на прежних
 *     версиях игры;
 *   • файл вещи — в папке последнего пака, где он есть (`<папка>/<файл>`).
 * Сверено: броня 01.2016 №0 — 17 (в игре, 04.10.2026), тяжёлый №1 — 15,
 * «Кепка Diamond» и «Худи Diamond» — начало коллекции казино, шарф и
 * «Цепочка с балаклавой» — начала коллекций hipster и luxe_01.
 *
 * Только чтение; разбор — секунды, кэш — в stateDir по отпечатку игры.
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { readPedVariation } from "@modovik/clothing/ped-variation";
import { COMPONENTS } from "@modovik/clothing/taxonomy";

/* 4 — `unconfirmed` только у ничьей `<order>` между паками одной группы и у пака без `setup2.xml` (ревью 15.11, №2 и №3), с ранних паков снята после пятого захода стенда: кэш прежней версии (помечены ранние паки) не принимается. */
export const ORDER_VERSION = 4;

const inflateRaw = (bytes) =>
  zlib.inflateRawSync(bytes, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
const YMT = /(?:^|\/)(mp_[mf]_freemode_01)(?:_([a-z0-9_]+))?\.ymt$/i;
const MODEL =
  /(?:^|\/)(mp_[mf]_freemode_01)(_p)?(?:_([a-z0-9_]+))?\/((?:p_)?[a-z]+)_(\d{3})(?:_[ur])?\.ydd$/i;
const PACK_ITEM =
  /<Item>\s*(?:platform:[\\/]+dlcpacks|dlcpacks:)[\\/]+([^\\/<\s]+)/gi;

const SETUP_ORDER = /<order\s+value="(\d+)"/i;
const SETUP_MINOR = /<minorOrder\s+value="(\d+)"/i;
/** Корневой `setup2.xml` пака: в `dlc.rpf` пака (`setup2.xml`) или в платформенном архиве (`dlcpacks/<пак>/dlc.rpf/setup2.xml`). */
const SETUP_FILE = /^(?:dlcpacks\/[^/]+\/dlc\.rpf\/)?setup2\.xml$/i;

/** `<order>` и `<minorOrder>` пака из `setup2.xml`; нет `<order>` — `null`. */
export function setupOrder(xml) {
  const order = SETUP_ORDER.exec(String(xml || ""))?.[1];
  if (order === undefined) return null;
  return { order: Number(order), minor: Number(SETUP_MINOR.exec(String(xml))?.[1] ?? 0) };
}

/** Список дополнений в порядке загрузки — из `dlclist.xml`. */
export function dlcOrder(xml) {
  /* Закомментированные записи (слой OpenIV) не считаются, повтор имени — первое вхождение (ревью 15.11.2026, №17). */
  const text = String(xml || "").replace(/<!--[\s\S]*?-->/g, "");
  const order = [];
  for (const match of text.matchAll(PACK_ITEM)) {
    const name = match[1].toLowerCase();
    if (!order.includes(name)) order.push(name);
  }
  return order;
}

/*
 * Пак-дом коллекции: `mp_m_freemode_01_mp_m_battle` → `mpbattle`, если
 * такой пак есть в списке и он раньше первого появления коллекции.
 */
const homeOf = (folder, rank) => {
  /* Только имя без номера коллекции: у `valentines_02` дом — не `mpvalentines`. */
  const suffix = /^mp_[mf]_freemode_01_mp_[mf]_([a-z0-9]+)$/.exec(folder)?.[1];
  return suffix && rank.has(`mp${suffix}`) ? `mp${suffix}` : null;
};

/**
 * Порядок по файлам игры: `io` даёт список дополнений, базовые раскладки и
 * содержимое паков. Возвращает коллекции по порядку номеров:
 * `[{ name, gender, rank, layout, files }]`, где `files` — `вид|номер` →
 * папка файла.
 */
export async function buildGameClothingOrder(io) {
  const packs = dlcOrder(await io.dlclist());
  const rank = new Map(packs.map((pack, index) => [pack, index]));
  const byName = new Map();
  const byFolder = new Map();
  const folderName = new Map();
  const collections = [];
  const note = (folder, pack, layout) => {
    if (!layout) return;
    /* Та же коллекция — то же имя `dlcName` или та же папка: у пака
       бывает две раскладки одной папки с разными именами. */
    const known = byFolder.get(folder) || byName.get(layout.dlcName || folder);
    if (known) {
      known.layout = layout;
      folderName.set(folder, known.name);
      byFolder.set(folder, known);
      if (layout.dlcName) byName.set(layout.dlcName, known);
      return;
    }
    const name = layout.dlcName || folder;
    folderName.set(folder, name);
    const entry = {
      name,
      folder,
      gender: /^mp_f_/.test(folder) ? "female" : "male",
      pack,
      rank: pack === "base" ? -1 : (rank.get(pack) ?? Number.MAX_SAFE_INTEGER),
      layout,
      files: {},
    };
    const home = pack === "base" ? null : homeOf(folder, rank);
    if (home && rank.get(home) < entry.rank) entry.rank = rank.get(home);
    byName.set(name, entry);
    byFolder.set(folder, entry);
    collections.push(entry);
  };
  /* `<order>` и `<minorOrder>` пака — порядок коллекций в сквозных номерах (шапка файла). */
  const setups = new Map();
  /* Паки из `x64w.rpf/dlcpacks` (ранние): в номерах идут первыми, раньше всех update-паков. */
  const platformPacks = new Set();
  const scan = async (pack, entries, read, meta = null) => {
    if (meta?.platform) platformPacks.add(pack);
    const models = [];
    for (const entry of entries) {
      if (pack !== "base" && SETUP_FILE.test(entry.path)) {
        const setup = setupOrder(Buffer.from(await read(entry.path)).toString("utf8"));
        if (setup) setups.set(pack, setup);
        continue;
      }
      const ymt = YMT.exec(entry.path);
      if (ymt) {
        if (pack === "base" ? ymt[2] : !ymt[2]) continue;
        const folder = `${ymt[1]}${ymt[2] ? `_${ymt[2]}` : ""}`.toLowerCase();
        note(folder, pack, readPedVariation(await read(entry.path), { inflateRaw }));
        continue;
      }
      const model = MODEL.exec(entry.path);
      if (model) models.push(model);
    }
    /* Файлы — после раскладок пака: папка узнаётся по раскладке. */
    for (const model of models) {
      if (pack === "base" ? model[3] : !model[3]) continue;
      const own = `${model[1]}${model[3] ? `_${model[3]}` : ""}`.toLowerCase();
      const collection = byName.get(folderName.get(own));
      if (!collection) continue;
      const folder = `${model[1]}${model[2] || ""}${model[3] ? `_${model[3]}` : ""}`.toLowerCase();
      collection.files[`${model[4].toLowerCase()}|${Number(model[5])}`] = folder;
    }
  };
  await io.withBase((entries, read) => scan("base", entries, read));
  for (const pack of packs)
    await io.withPack(pack, (entries, read, meta) => scan(pack, entries, read, meta));
  /* Заплатка `update.rpf/dlc_patch/<пак>/setup2.xml` старше `setup2.xml` самого пака. */
  for (const [pack, xml] of (await io.patchSetups?.()) || []) {
    const setup = setupOrder(xml);
    if (setup) setups.set(String(pack).toLowerCase(), setup);
  }
  /* Порядок коллекций (четвёртый заход стенда, 15.11.2026): база; паки из `x64w.rpf` (ранние) — по СВОЕМУ `<order>`/`<minorOrder>`; затем паки update — по `<order>`/`<minorOrder>`; при равенстве — по месту в `dlclist.xml`;
     паки update без `setup2.xml` (в игре таких нет, так бывает в проверках) стоят перед теми, у кого он есть, по месту в списке. Кадры игры: жен. низ 16 — beach №0, 18 — christmas №0, 30 — lts №0, муж. маска 18 — hipster №1;
     по `dlclist.xml` на 18 стоял бы business №0, по `setup2.xml` без деления на ранние и update — xmas2 №0 (`mppatchesng`, order 0 делит его с `mpbeach`). */
  const packOf = (collection) => (collection.rank < 0 ? null : packs[collection.rank]);
  const sortKey = (collection) => {
    const pack = packOf(collection);
    const setup = setups.get(pack);
    if (collection.rank < 0) return [-1, 0, 0, 0];
    if (platformPacks.has(pack)) return [0, setup?.order ?? Number.MAX_SAFE_INTEGER, setup?.minor ?? 0, collection.rank];
    return setup ? [2, setup.order, setup.minor, collection.rank] : [1, collection.rank, 0, 0];
  };
  /* Ничья `<order>`/`<minorOrder>` между паками одной группы — ранними (x64w) или update (ревью 15.11, №2): кто из двух первый, решало место в `dlclist.xml`, игра это не проверяла — номера вещей обоих не подтверждены.
     Ничья внутри пака (две коллекции одного пака) порядка паков не касается; ранний пак и update-пак с тем же `<order>` — разные группы. На игре владельца ничьих нет: пятый заход подтвердил порядок по `setup2.xml`. */
  const tiedPacks = new Set();
  {
    const bySetup = new Map();
    for (const collection of collections) {
      const pack = packOf(collection);
      const setup = setups.get(pack);
      if (pack === null || !setup) continue;
      const key = `${platformPacks.has(pack) ? "x64w" : "update"}|${setup.order}|${setup.minor}`;
      bySetup.set(key, (bySetup.get(key) || new Set()).add(pack));
    }
    for (const group of bySetup.values()) if (group.size > 1) for (const pack of group) tiedPacks.add(pack);
  }
  /* Пак без `setup2.xml` или без `<order>` (ревью 15.11, №3; в игре такого нет — редукс-пак в `dlclist.xml`, битая запись) стоит в конце ранней группы или в начале update, а где он в игре — неизвестно. Ранний —
     не подтверждён он сам (сумм ранней группы он не меняет: update идёт после неё всегда); update — он и всё после него, сдвиг от его вещей ложится на все следующие коллекции. */
  const looseEarly = (collection) => platformPacks.has(packOf(collection)) && !setups.has(packOf(collection));
  const loose = (collection) => collection.rank >= 0 && !platformPacks.has(packOf(collection)) && !setups.has(packOf(collection));
  collections.sort((left, right) => {
    const a = sortKey(left);
    const b = sortKey(right);
    for (let at = 0; at < a.length; at += 1) if (a[at] !== b[at]) return a[at] - b[at];
    return 0;
  });
  const firstLoose = collections.findIndex(loose);
  return {
    version: ORDER_VERSION,
    packs,
    collections: collections.map((collection, index) => ({
      name: collection.name,
      gender: collection.gender,
      rank: collection.rank,
      ...(setups.get(packs[collection.rank]) ? { setup: setups.get(packs[collection.rank]) } : {}),
      ...(tiedPacks.has(packOf(collection)) || looseEarly(collection) || (firstLoose >= 0 && index >= firstLoose) ? { unconfirmed: true } : {}),
      drawables: collection.layout.drawables,
      props: collection.layout.props,
      files: collection.files,
    })),
  };
}

/**
 * Номер → место: `[{ folder, drawable, textures } | null]` для пола и
 * вида; `null` — у номера нет файла (пустая вещь раскладки).
 */
export function clothingOrder(order, gender, component) {
  const prop = Boolean(COMPONENTS[component]?.prop);
  const places = [];
  for (const collection of order?.collections || []) {
    if (collection.gender !== gender) continue;
    const textures = (prop ? collection.props : collection.drawables)?.[component] || [];
    textures.forEach((count, drawable) => {
      const folder = collection.files[`${component}|${drawable}`] || null;
      /* `unconfirmed` — порядок этой коллекции игрой не проверен (ничья `<order>`, пак без `setup2.xml`; см. `buildGameClothingOrder`): адресатом заменёнки номер не отдаётся. */
      places.push(folder ? { folder, drawable, textures: count, ...(collection.unconfirmed ? { unconfirmed: true } : {}) } : null);
    });
  }
  return places;
}
/* Чтение файлов игры: база, ранние паки из x64w.rpf, остальные — из update. */
export function gameOrderFiles(gameRoot, keys) {
  return {
    async dlclist() {
      const update = await openRpfFile(path.join(gameRoot, "update", "update.rpf"), {
        keys,
        nested: false,
      });
      try {
        return Buffer.from(await update.read("common/data/dlclist.xml")).toString("utf8");
      } finally {
        await update.close();
      }
    },
    /** Заплатки `update.rpf/dlc_patch/<пак>/setup2.xml`: пак → текст. */
    async patchSetups() {
      const update = await openRpfFile(path.join(gameRoot, "update", "update.rpf"), {
        keys,
        nested: false,
      });
      const found = new Map();
      try {
        for (const entry of update.entries) {
          const hit = /^dlc_patch\/([^/]+)\/setup2\.xml$/i.exec(entry.path);
          if (hit && entry.kind !== "directory")
            found.set(hit[1].toLowerCase(), Buffer.from(await update.read(entry.path)).toString("utf8"));
        }
      } finally {
        await update.close();
      }
      return found;
    },
    async withBase(scan) {
      const base = await openRpfFile(path.join(gameRoot, "x64v.rpf"), { keys });
      try {
        await scan(
          base.entries.filter((entry) => /^models\/cdimages\/streamedped(?:s_mp|props)\.rpf\//i.test(entry.path)),
          (entryPath) => base.read(entryPath),
        );
      } finally {
        await base.close();
      }
    },
    platform: null,
    async withPack(pack, scan) {
      let archive = null;
      try {
        archive = await openRpfFile(
          path.join(gameRoot, "update", "x64", "dlcpacks", pack, "dlc.rpf"),
          { keys },
        );
      } catch {
        archive = null;
      }
      if (archive) {
        try {
          await scan(archive.entries, (entryPath) => archive.read(entryPath));
        } finally {
          await archive.close();
        }
        return;
      }
      this.platform ||= await openRpfFile(path.join(gameRoot, "x64w.rpf"), { keys }).catch(() => null);
      if (!this.platform) return;
      const prefix = `dlcpacks/${pack}/dlc.rpf/`;
      const entries = this.platform.entries.filter((entry) => entry.path.toLowerCase().startsWith(prefix));
      if (entries.length) await scan(entries, (entryPath) => this.platform.read(entryPath), { platform: true });
    },
    async close() {
      await this.platform?.close?.();
      this.platform = null;
    },
    async fingerprint() {
      const stat = async (file) => {
        const info = await fs.stat(file).catch(() => null);
        return info ? `${info.size}:${Math.floor(info.mtimeMs)}` : "-";
      };
      const parts = [
        await stat(path.join(gameRoot, "update", "update.rpf")),
        await stat(path.join(gameRoot, "x64v.rpf")),
        await stat(path.join(gameRoot, "x64w.rpf")),
      ];
      const packs = await fs
        .readdir(path.join(gameRoot, "update", "x64", "dlcpacks"))
        .catch(() => []);
      parts.push(packs.sort().join(","));
      return createHash("sha256").update(parts.join("|")).digest("hex");
    },
  };
}

const memo = new Map();

/** Порядок из кэша или собранный заново (секунды). */
export async function readGameClothingOrder({ gameRoot, stateDir, keysDirectory, io = null }) {
  const files =
    io ||
    gameOrderFiles(gameRoot, keysDirectory ? await keysFromDirectory(keysDirectory) : null);
  const fingerprint = await files.fingerprint();
  const remembered = memo.get(gameRoot);
  if (remembered?.fingerprint === fingerprint) return remembered.order;
  const cache = path.join(
    stateDir,
    "clothing-index",
    `order-${createHash("sha256").update(String(gameRoot).toLowerCase()).digest("hex").slice(0, 16)}.json`,
  );
  const stored = await fs
    .readFile(cache, "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => null);
  if (stored?.version === ORDER_VERSION && stored.fingerprint === fingerprint) {
    memo.set(gameRoot, { fingerprint, order: stored });
    return stored;
  }
  let order;
  try {
    order = await buildGameClothingOrder(files);
  } finally {
    await files.close?.();
  }
  order.fingerprint = fingerprint;
  await fs.mkdir(path.dirname(cache), { recursive: true });
  const temporary = `${cache}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(order));
  await fs.rename(temporary, cache);
  memo.set(gameRoot, { fingerprint, order });
  return order;
}
