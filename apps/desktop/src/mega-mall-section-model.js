/*
 * Секция карты из установленной игры — Davis Mega Mall целиком.
 *
 * Здание торгового центра в GTA — не один drawable. Это секция карты
 * `sc1_22`: главный корпус, декор фасада, козырьки, перила, лестницы, две
 * парковки с разметкой, стойка вывески — двадцать с лишним деталей, каждая
 * расставлена своим ymap-ом, описана архетипом в ytyp и одета текстурами из
 * трёх уровней словарей: собственного (`sc1_22_mall_04bb+hidr`), секционного
 * (`sc1_22_hd`, `sc1_22_detail`) и общегородского (`southcentralrd` →
 * `cityeastrd` → `globalroads` по родству из `gtxd.ymt`). Вокруг — сотни
 * типовых пропов из общих паков игры: столбики, урны, тележки, кусты. На
 * расстоянии игра подменяет всё это LOD-моделями из словарей
 * `*_slod1_children` и одной SLOD1 на квартал.
 *
 * Провайдер собирает из этого манифест — какие детали нужны, где лежат, как
 * стоят и кто кого подменяет на расстоянии, — и четыре бандла GLB:
 *
 *   hd    — детали самой секции (здание, парковка, козырьки);
 *   near  — соседи из того же района в радиусе якоря (заправка, дорога);
 *   props — типовые пропы из общих паков игры (по одному экземпляру на
 *           модель; сцена расставляет их инстансами);
 *   lod   — подмены издалека (LOD и SLOD1) для всего перечисленного.
 *
 * Бандл — один файл на все детали с общими текстурами: поштучная
 * конвертация уносила по копии атласа в каждую деталь, 23 мегабайта на один
 * только корпус.
 *
 * Все имена и числа ниже добыты живой сборкой на установленной игре
 * (Steam, сборка 24129523). Ничего от Rockstar в сборку лаунчера не попадает:
 * бандлы живут только в локальном кэше пользователя.
 */

import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import { joaatHash } from "./arena-hall-model.js";

/*
 * Секции, которые умеет собрать провайдер. У каждой — архив с метаданными и
 * деталями, район (все паки квартала — там живут словари LOD и соседи) и
 * якорь: мировая точка, вокруг которой собираются сущности и которая
 * становится началом координат сцены. Якорь молла — та же точка, куда
 * нативный компилятор ставит оверлей фасадов (`MegaMallOverlayCommands.cs`),
 * поэтому панели дизайна и настоящие стены в кадре совпадают без подгонки.
 */
export const MEGA_MALL_SECTIONS = Object.freeze({
  "davis-mega-mall": Object.freeze({
    label: "Davis Mega Mall",
    archive: "x64k.rpf",
    metadata: "levels/gta5/_citye/scentral_01/scentral_metadata.rpf/",
    /* Паки самой секции: их детали идут в бандл `hd`. */
    sectionPacks: Object.freeze(["levels/gta5/_citye/scentral_01/sc1_22.rpf/"]),
    /* Район целиком: словари LOD-подмен, текстуры соседних секций, соседи. */
    district: "levels/gta5/_citye/scentral_01/",
    /* Родство словарей текстур и сами общегородские словари. */
    sharedArchive: "x64g.rpf",
    sharedPack: "levels/gta5/generic/gtxd.rpf/",
    /* Только ymap-ы этого района: у соседних районов свои секции. */
    ymapPrefix: "sc1_",
    anchor: Object.freeze({ x: 70.89937, y: -1773.2747, z: 35.434685 }),
    radius: 140,
    /* Типовые пропы ищутся по всем ванильным архивам игры. */
    props: true,
  }),
  /*
   * Под эстакадой шоссе в центре Лос-Сантоса: кадр «Под мостом» редактора
   * «Фонари» (задача 25 ТЗ 18.10.2026; до этого здесь был мост над руслом реки
   * в Сан-Педро). Сверху улица (земля около 43 м), под ней настил шоссе, внизу
   * дорога с заграждениями; на потолке — трубки `dt1_rd1_fwy03_detail1`
   * (капсулы и пятна вниз, лист полосы `striplight`). Якорь — уровень нижней
   * дороги (z = 30,6) под настилом: земля внизу лежит в плоскости y = 0.
   * Шесть деталей в `hd`: настил, подпорные стены и нижняя дорога.
   */
  "downtown-overpass": Object.freeze({
    label: "Центр, под эстакадой шоссе",
    archive: "x64i.rpf",
    metadata: "levels/gta5/_citye/downtown_01/downtown_01_metadata.rpf/",
    sectionPacks: Object.freeze(["levels/gta5/_citye/downtown_01/dt1_rd1.rpf/"]),
    district: "levels/gta5/_citye/downtown_01/",
    sharedArchive: "x64g.rpf",
    sharedPack: "levels/gta5/generic/gtxd.rpf/",
    ymapPrefix: "",
    anchor: Object.freeze({ x: 55, y: -705, z: 30.6 }),
    radius: 55,
    props: true,
  }),
  /*
   * Море у пляжа Венис-Бич: кадр редактора «Вода» (задача 20 ТЗ 18.10.2026) — от
   * песка и отмели к подводным склонам, кораллам и водорослям. Паки: подводное
   * дно (`vb_35b`), пляжи (`vb_35`) и береговая линия (`vb_34`). Начало координат
   * сцены — уровень моря (z = 0) над точкой (−1790, −1110): так поверхность воды
   * лежит ровно в плоскости y = 0, а глубина — это высота дна с минусом.
   */
  "venice-sea": Object.freeze({
    label: "Венис-Бич, море у берега",
    archive: "x64m.rpf",
    metadata: "levels/gta5/_cityw/venice_01/venice_metadata.rpf/",
    sectionPacks: Object.freeze([
      "levels/gta5/_cityw/venice_01/vb_35b.rpf/",
      "levels/gta5/_cityw/venice_01/vb_35.rpf/",
      "levels/gta5/_cityw/venice_01/vb_34.rpf/",
    ]),
    district: "levels/gta5/_cityw/venice_01/",
    sharedArchive: "x64g.rpf",
    sharedPack: "levels/gta5/generic/gtxd.rpf/",
    ymapPrefix: "vb_",
    anchor: Object.freeze({ x: -1700, y: -1110, z: 0 }),
    radius: 270,
    props: true,
  }),
});

export const MEGA_MALL_SECTION_BUNDLES = Object.freeze([
  "hd",
  "near",
  "props",
  "lod",
]);

/* Версия конвейера входит в ключ кэша: правка сборки манифеста или нативного
   конвертера обесценивает старые файлы сама, без ручной чистки.
   5 — листы нормалей BC5 декодируются верно (12.10.2026).
   6 — флаги архетипа в манифесте: теневой прокси (`0x800`) кадр кладёт только
   в карту теней, а не в цвет (20.11.2026, щиты Self Storage). */
const PIPELINE_VERSION = 6;

const MAX_BUNDLE_BYTES = 160 * 1024 * 1024;
const MAX_ENTRIES_PER_LISTING = 20000;
const MAX_ARCHIVE_INDEX_ENTRIES = 400000;

/*
 * Текстуры бандла: здание смотрят вблизи, пропы и подмены — нет. Карты
 * нормалей — PNG и втрое тяжелее диффуза того же размера; у соседей они
 * вдвое меньше диффуза, у пропов и подмен их нет вовсе. Замерено на живой
 * игре: соседи с полными текстурами весили 103 МБ, пропы — 58.
 */
const BUNDLE_TEXTURES = Object.freeze({
  hd: Object.freeze({
    maxTextureSize: 1024,
    maxNormalTextureSize: 512,
    normalMaps: true,
  }),
  /* Соседей смотрят с полусотни метров и дальше: 256 хватает, а видеопамяти
     уходит вчетверо меньше, чем на 512 (замерено: 42 МБ бандла → ~450 МБ
     распакованных текстур). */
  near: Object.freeze({
    maxTextureSize: 256,
    maxNormalTextureSize: 128,
    normalMaps: true,
  }),
  props: Object.freeze({
    maxTextureSize: 256,
    maxNormalTextureSize: 128,
    normalMaps: false,
  }),
  lod: Object.freeze({
    maxTextureSize: 256,
    maxNormalTextureSize: 128,
    normalMaps: false,
  }),
});

/*
 * Уровни детализации сущностей ymap в порядке игры (`rage__eLodType`).
 * Порядок — не справка: по нему CodeWalker решает, где искать родителя
 * сущности — в том же ymap или в родительском (см. `parentOf`).
 */
const LOD_RANK = Object.freeze({
  HD: 0,
  LOD: 1,
  SLOD1: 2,
  SLOD2: 3,
  SLOD3: 4,
  ORPHANHD: 5,
  SLOD4: 6,
});

/* Какие уровни манифест берёт в сцену. SLOD2/SLOD3 — километровые силуэты
   района, для кадра одного здания они лишние. */
const LOD_BUNDLE = Object.freeze({
  HD: "hd",
  ORPHANHD: "hd",
  LOD: "lod",
  SLOD1: "lod",
});

/* Текстурные словари игры делятся на базовый и HD-версии: `<txd>+hi` для
   словарей секции, `<drawable>+hidr`/`+hifr` для текстур, зашитых в саму
   модель. Порядок важен: поздний словарь перекрывает ранний. */
const HD_SUFFIXES = Object.freeze(["+hi", "+hidr", "+hifr"]);

const MODEL_EXTENSIONS = Object.freeze([".ydr", ".yft"]);

const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

const finite = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const stemOf = (entryPath) =>
  path
    .basename(String(entryPath))
    .replace(/\.[^.]+$/, "")
    .toLowerCase();

const extensionOf = (entryPath) =>
  path.extname(String(entryPath)).toLowerCase();

const directoryOf = (entryPath) => {
  const normalized = String(entryPath).replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash + 1);
};

/* Хэш из ответа нативного хоста: "0x…", десятичная строка или число. */
export function parseHash(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0;
  const text = String(value ?? "").trim();
  if (/^0x[0-9a-f]{1,8}$/i.test(text)) return Number.parseInt(text, 16) >>> 0;
  if (/^\d{1,10}$/.test(text)) return Number(text) >>> 0;
  return null;
}

const hex = (hash) => `0x${(hash >>> 0).toString(16).padStart(8, "0")}`;

/*
 * Индекс файлов по joaat(стем) и по имени: так сущность ymap (хэш архетипа)
 * и архетип ytyp (хэш словаря) находят свой файл. Первый найденный файл
 * побеждает — вызывающий кладёт более точные паки раньше.
 */
class EntryIndex {
  constructor() {
    this.byHash = new Map();
    this.byName = new Map();
    this.archives = new Map();
  }

  add(archive, entries) {
    for (const entry of entries) {
      const extension = extensionOf(entry);
      const stem = stemOf(entry);
      const nameKey = `${directoryOf(entry).toLowerCase()}${stem}${extension}`;
      if (!this.byName.has(nameKey)) this.byName.set(nameKey, entry);
      const hashKey = `${joaatHash(stem)}${extension}`;
      if (!this.byHash.has(hashKey)) this.byHash.set(hashKey, entry);
      if (!this.archives.has(entry)) this.archives.set(entry, archive);
    }
  }

  findHash(hash, extension) {
    const entry = this.byHash.get(`${hash}${extension}`);
    return entry ? { entry, archive: this.archives.get(entry) } : null;
  }

  findName(directory, name) {
    const entry = this.byName.get(`${directory.toLowerCase()}${name}`);
    return entry ? { entry, archive: this.archives.get(entry) } : null;
  }
}

export function createMegaMallSectionProvider({
  cacheRoot,
  findGame,
  extractEntries,
  listEntries,
  inspectMapFiles,
  convertScene,
  tempRoot = os.tmpdir(),
  sections = MEGA_MALL_SECTIONS,
} = {}) {
  if (!cacheRoot)
    throw new TypeError("Mega Mall section provider требует cacheRoot.");
  for (const [name, tool] of Object.entries({
    findGame,
    extractEntries,
    listEntries,
    inspectMapFiles,
    convertScene,
  })) {
    if (typeof tool !== "function")
      throw new TypeError(`Mega Mall section provider требует ${name}.`);
  }

  const resolveGameRoot = async (targetId) => {
    try {
      const game = await findGame(targetId);
      return game?.path ? path.resolve(String(game.path)) : null;
    } catch {
      return null;
    }
  };

  const statKey = async (file) => {
    const stat = await fs.stat(file);
    return `${String(stat.size)}-${String(Math.trunc(stat.mtimeMs))}`;
  };

  /* Ключ кэша от версии конвейера и обоих архивов: патч игры обесценивает и
     манифест, и бандлы сам. */
  const cacheKey = async (sectionId, archives) => {
    const parts = [`v${PIPELINE_VERSION}`, sectionId];
    for (const archive of archives) {
      parts.push(archive.toLowerCase(), await statKey(archive));
    }
    return sha256Hex(parts.join("|")).slice(0, 32);
  };

  const writeCached = async (file, bytes) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const staging = `${file}.${process.pid}.part`;
    await fs.writeFile(staging, bytes);
    await fs.rename(staging, file).catch(async (error) => {
      await fs.rm(staging, { force: true });
      try {
        await fs.stat(file);
      } catch {
        throw error;
      }
    });
  };

  /* ---------- листинги ---------- */

  const listPack = async ({ gameRoot, archive, filter }) => {
    const listing = await listEntries({
      gameRoot,
      archive,
      filter,
      maxEntries: MAX_ENTRIES_PER_LISTING,
    });
    if (listing?.truncated) {
      throw new Error(
        `Листинг ${archive}/${filter} обрезан нативным движком — пак больше ожидаемого.`,
      );
    }
    return (Array.isArray(listing?.entries) ? listing.entries : [])
      .map((entry) => String(entry?.path || ""))
      .filter((entry) => entry.toLowerCase().startsWith(filter.toLowerCase()));
  };

  /*
   * Индекс целого архива — для типовых пропов, которые лежат где угодно:
   * столбики в x64h, кусты в x64f, урны в x64i. Сто пятьдесят тысяч записей
   * на все ванильные архивы, полсекунды на архив; результат живёт в кэше под
   * размером и датой архива, так что патч игры обновляет его сам.
   */
  const archiveIndex = async ({ gameRoot, archive }) => {
    const file = path.join(gameRoot, archive);
    const key = await statKey(file);
    const cacheFile = path.join(
      cacheRoot,
      "archive-index",
      `${stemOf(archive)}-${key}.json`,
    );
    try {
      const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
      if (Array.isArray(cached?.entries)) return cached.entries;
    } catch {
      /* Нет индекса — строим. */
    }
    const workspace = await fs.mkdtemp(
      path.join(tempRoot, "astral-mall-index-"),
    );
    try {
      const output = path.join(workspace, "index.json");
      const listing = await listEntries({
        gameRoot,
        archive,
        output,
        maxEntries: MAX_ARCHIVE_INDEX_ENTRIES,
        depth: 4,
      });
      const data = listing?.entries
        ? listing
        : JSON.parse(
            await fs.readFile(String(listing?.output || output), "utf8"),
          );
      const entries = (Array.isArray(data?.entries) ? data.entries : [])
        .map((entry) => String(entry?.path || ""))
        .filter((entry) => /\.(ydr|yft|ydd|ytd|ytyp)$/i.test(entry));
      await writeCached(
        cacheFile,
        JSON.stringify({ archive, key, entries }),
      ).catch(() => {});
      return entries;
    } finally {
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    }
  };

  const vanillaArchives = async (gameRoot) => {
    try {
      return (await fs.readdir(gameRoot))
        .filter((name) => /^x64[a-z]\.rpf$/i.test(name))
        .sort();
    } catch {
      return [];
    }
  };

  /* ---------- разбор метаданных ---------- */

  const inspectExtracted = async ({ gameRoot, groups, workspace }) => {
    /* groups: [{ archivePath, entries }] — одна распаковка на архив. */
    const outputs = [];
    for (const { archivePath, entries } of groups) {
      if (!entries.length) continue;
      const extracted = await extractEntries({
        archivePath,
        entries,
        outputDirectory: path.join(workspace, stemOf(archivePath)),
        gameRoot,
      });
      for (const item of extracted?.extracted || [])
        outputs.push(String(item.output));
    }
    if (!outputs.length) return [];
    const listFile = path.join(workspace, `inspect-${outputs.length}.json`);
    const outputFile = path.join(
      workspace,
      `inspect-${outputs.length}-result.json`,
    );
    await fs.writeFile(listFile, JSON.stringify(outputs));
    await inspectMapFiles({ list: listFile, output: outputFile });
    const inspection = JSON.parse(await fs.readFile(outputFile, "utf8"));
    return Array.isArray(inspection?.files) ? inspection.files : [];
  };

  const archetypeIndex = (ytyps, into = new Map()) => {
    for (const ytyp of ytyps) {
      for (const archetype of ytyp.archetypes || []) {
        const hash = parseHash(archetype.nameHash);
        if (hash === null || into.has(hash)) continue;
        into.set(hash, { ...archetype, ytyp: stemOf(ytyp.input) });
      }
    }
    return into;
  };

  /* ---------- сборка манифеста ---------- */

  const buildManifest = async ({ sectionId, section, gameRoot, key }) => {
    const startedAt = Date.now();
    const timings = {};
    const lap = (label, since) => {
      timings[label] = Date.now() - since;
    };

    let since = Date.now();
    const districtEntries = await listPack({
      gameRoot,
      archive: section.archive,
      filter: section.district,
    });
    const sharedEntries = await listPack({
      gameRoot,
      archive: section.sharedArchive,
      filter: section.sharedPack,
    });
    lap("listing", since);

    const metadataEntries = districtEntries.filter((entry) =>
      entry.toLowerCase().startsWith(section.metadata.toLowerCase()),
    );
    const ymapEntries = metadataEntries.filter(
      (entry) =>
        extensionOf(entry) === ".ymap" &&
        stemOf(entry).startsWith(section.ymapPrefix),
    );
    const ytypEntries = metadataEntries.filter(
      (entry) => extensionOf(entry) === ".ytyp",
    );
    const gtxdEntry = sharedEntries.find(
      (entry) => stemOf(entry) === "gtxd" && extensionOf(entry) === ".ymt",
    );
    if (!ymapEntries.length || !ytypEntries.length) {
      throw new Error(
        `В ${section.archive} не нашлось метаданных секции ${sectionId}.`,
      );
    }
    if (!gtxdEntry) {
      throw new Error(`В ${section.sharedArchive} не нашлось gtxd.ymt.`);
    }

    /* Индексы: паки секции раньше района — деталь секции побеждает
       одноимённого соседа; общегородские словари — после района. */
    const isSectionEntry = (entry) =>
      section.sectionPacks.some((pack) =>
        entry.toLowerCase().startsWith(pack.toLowerCase()),
      );
    const sectionEntries = districtEntries.filter(isSectionEntry);
    const files = new EntryIndex();
    files.add(section.archive, sectionEntries);
    files.add(section.archive, districtEntries);
    files.add(section.sharedArchive, sharedEntries);

    /* Распаковка и разбор метаданных района — одна на архив. */
    since = Date.now();
    const workspace = await fs.mkdtemp(
      path.join(tempRoot, "astral-mall-section-"),
    );
    let ymaps = [];
    let ytyps = [];
    let gtxd = null;
    let broken = [];
    try {
      const inspected = await inspectExtracted({
        gameRoot,
        workspace,
        groups: [
          {
            archivePath: path.join(gameRoot, section.archive),
            entries: [...ymapEntries, ...ytypEntries],
          },
          {
            archivePath: path.join(gameRoot, section.sharedArchive),
            entries: [gtxdEntry],
          },
        ],
      });
      ymaps = inspected.filter((file) => file.kind === "ymap");
      ytyps = inspected.filter((file) => file.kind === "ytyp");
      gtxd = inspected.find((file) => file.kind === "gtxd") || null;
      broken = inspected.filter((file) => file.kind === "error");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    }
    lap("metadata", since);
    if (!ymaps.length || !ytyps.length || !gtxd) {
      throw new Error(
        `Нативный разбор метаданных не удался: ${broken
          .map((file) => `${path.basename(file.input)}: ${file.error?.message}`)
          .slice(0, 3)
          .join("; ")}`,
      );
    }

    const archetypes = archetypeIndex(ytyps);

    /* Родство словарей по хэшам: имена в ytyp лежат хэшами. */
    const parentByHash = new Map();
    for (const relation of gtxd.parents || []) {
      const child = parseHash(relation.childHash);
      const parent = parseHash(relation.parentHash);
      if (child !== null && parent !== null && !parentByHash.has(child))
        parentByHash.set(child, parent);
    }

    /* ymap-ы по хэшу имени — так сущность находит родителя в другом ymap. */
    const ymapByHash = new Map();
    for (const ymap of ymaps) {
      const hash = parseHash(ymap.nameHash);
      if (hash !== null) ymapByHash.set(hash, ymap);
    }
    const entityId = (ymap, index) => `${stemOf(ymap.input)}:${index}`;
    const distanceTo = (position) =>
      Math.hypot(
        finite(position?.x) - section.anchor.x,
        finite(position?.y) - section.anchor.y,
      );

    /*
     * Родитель сущности — по правилу CodeWalker (`YmapFile.cs`): индекс
     * `parentIndex` указывает на сущность ТОГО ЖЕ ymap, если та есть и стоит
     * уровнем грубее (LOD → SLOD1 внутри `sc1_22.ymap`); иначе — на сущность
     * родительского ymap (HD из `_strm` → LOD в `sc1_22.ymap`, SLOD1 → SLOD2
     * в `sc1_lod.ymap`). Бит 1 флагов сущности принудительно уводит родителя
     * в родительский ymap. Без этого правила у молла терялась SLOD1-подмена:
     * её индекс искали в `sc1_lod.ymap`, где он указывает на чужой силуэт.
     */
    const parentOf = (ymap, entity) => {
      const index = Number(entity.parentIndex);
      if (!Number.isInteger(index) || index < 0) return null;
      const entities = ymap.entities || [];
      const lodInParent = ((finite(entity.flags) >>> 1) & 1) === 1;
      if (!lodInParent && index < entities.length) {
        const candidate = entities.find((item) => item.index === index);
        const childRank = LOD_RANK[entity.lodLevel] ?? 0;
        const parentRank = LOD_RANK[candidate?.lodLevel] ?? 0;
        const orphanParent =
          candidate?.lodLevel === "ORPHANHD" && entity.lodLevel !== "ORPHANHD";
        if (candidate && parentRank > childRank && !orphanParent)
          return { ymap, entity: candidate };
      }
      const parentYmap = ymapByHash.get(parseHash(ymap.parentHash));
      const parent = (parentYmap?.entities || []).find(
        (candidate) => candidate.index === index,
      );
      return parent ? { ymap: parentYmap, entity: parent } : null;
    };

    /*
     * Отбор сущностей. Вблизи — всё, что стоит в радиусе якоря. Подмены
     * издалека (LOD, SLOD1) берутся не по радиусу, а по родству: у каждой
     * взятой детали вблизи есть родитель-LOD, у того — SLOD1, и именно они
     * заменяют её, когда камера отъезжает. Так в манифест не попадают чужие
     * LOD-силуэты соседних кварталов, а свои — гарантированно попадают.
     */
    const selected = new Map();
    const take = (ymap, entity) => {
      const id = entityId(ymap, entity.index);
      if (!selected.has(id))
        selected.set(id, { id, ymap, entity, parent: null });
      return selected.get(id);
    };
    for (const ymap of ymaps) {
      for (const entity of ymap.entities || []) {
        if (LOD_BUNDLE[entity.lodLevel] !== "hd") continue;
        if (distanceTo(entity.position) > section.radius) continue;
        let record = take(ymap, entity);
        let cursor = { ymap, entity };
        for (let depth = 0; depth < 4; depth += 1) {
          const parent = parentOf(cursor.ymap, cursor.entity);
          if (!parent || !LOD_BUNDLE[parent.entity.lodLevel]) break;
          const parentRecord = take(parent.ymap, parent.entity);
          record.parent = parentRecord.id;
          record = parentRecord;
          cursor = parent;
        }
      }
    }

    /* ---------- типовые пропы: индекс по всем архивам ---------- */

    since = Date.now();
    const global = new EntryIndex();
    const propYtyps = new Map();
    const unresolvedHd = new Set();
    for (const record of selected.values()) {
      const hash = parseHash(record.entity.archetypeHash);
      if (hash === null) continue;
      const archetype = archetypes.get(hash);
      const assetType = archetype?.assetType || "drawable";
      if (assetType === "drawabledictionary") continue;
      const assetHash = parseHash(archetype?.assetHash) ?? hash;
      if (
        !files.findHash(assetHash, ".ydr") &&
        !files.findHash(assetHash, ".yft") &&
        LOD_BUNDLE[record.entity.lodLevel] === "hd"
      )
        unresolvedHd.add(assetHash);
    }
    if (section.props && unresolvedHd.size) {
      for (const archive of await vanillaArchives(gameRoot)) {
        if (archive.toLowerCase() === section.archive.toLowerCase()) continue;
        if (archive.toLowerCase() === section.sharedArchive.toLowerCase())
          continue;
        global.add(archive, await archiveIndex({ gameRoot, archive }));
      }
      /* ytyp-ы паков, где нашлись пропы: там их архетипы — словарь текстур,
         габариты, дистанция. Один пак — один ytyp, инспекция одной пачкой. */
      for (const assetHash of unresolvedHd) {
        const found =
          global.findHash(assetHash, ".ydr") ||
          global.findHash(assetHash, ".yft");
        if (!found) continue;
        const directory = directoryOf(found.entry);
        for (const [entry, archive] of global.archives) {
          if (archive !== found.archive) continue;
          if (extensionOf(entry) !== ".ytyp") continue;
          if (directoryOf(entry).toLowerCase() !== directory.toLowerCase())
            continue;
          propYtyps.set(`${archive}|${entry}`, { archive, entry });
        }
      }
      if (propYtyps.size) {
        const groups = new Map();
        for (const { archive, entry } of propYtyps.values()) {
          if (!groups.has(archive)) groups.set(archive, []);
          groups.get(archive).push(entry);
        }
        const propWorkspace = await fs.mkdtemp(
          path.join(tempRoot, "astral-mall-props-"),
        );
        try {
          const inspected = await inspectExtracted({
            gameRoot,
            workspace: propWorkspace,
            groups: [...groups].map(([archive, entries]) => ({
              archivePath: path.join(gameRoot, archive),
              entries,
            })),
          });
          archetypeIndex(
            inspected.filter((file) => file.kind === "ytyp"),
            archetypes,
          );
          broken.push(...inspected.filter((file) => file.kind === "error"));
        } finally {
          await fs
            .rm(propWorkspace, { recursive: true, force: true })
            .catch(() => {});
        }
      }
    }
    lap("props", since);

    /* ---------- разрешение архетипов в файлы ---------- */

    const hdVariants = (found, index) => {
      const directory = directoryOf(found.entry);
      const stem = stemOf(found.entry);
      return HD_SUFFIXES.map((suffix) =>
        index.findName(directory, `${stem}${suffix}.ytd`),
      ).filter(Boolean);
    };
    const textureFor = (txdHash, preferred) => {
      for (const index of [preferred, files, global]) {
        const found = index?.findHash(txdHash, ".ytd");
        if (found) return { found, index };
      }
      return null;
    };
    /*
     * Словари детали: от корня родства (`globalroads`) к листу (`sc1_22_hd`)
     * — поздний перекрывает ранний, а лист самый точный; каждый — с HD-версией,
     * если она есть; в конце — HD-версии текстур, зашитых в саму модель.
     * Деталь без описанного словаря (архетип не нашёлся) получает все словари
     * своего пака: угадывать по именам было бы враньём.
     */
    const dictionaryChain = ({ txdHash, model, preferred }) => {
      const result = [];
      const push = (item) => {
        if (!item) return;
        if (!result.some((known) => known.entry === item.entry))
          result.push(item);
      };
      if (txdHash !== null && txdHash !== 0) {
        const chain = [];
        const seen = new Set();
        let cursor = txdHash;
        while (cursor !== null && cursor !== 0 && !seen.has(cursor)) {
          seen.add(cursor);
          chain.unshift(cursor);
          cursor = parentByHash.has(cursor) ? parentByHash.get(cursor) : null;
        }
        for (const hash of chain) {
          const hit = textureFor(hash, preferred);
          if (!hit) continue;
          push(hit.found);
          for (const variant of hdVariants(hit.found, hit.index)) push(variant);
        }
      } else if (model) {
        const directory = directoryOf(model.found.entry).toLowerCase();
        for (const [entry, archive] of model.index.archives) {
          if (archive !== model.found.archive) continue;
          if (extensionOf(entry) !== ".ytd") continue;
          if (directoryOf(entry).toLowerCase() !== directory) continue;
          if (result.length >= 8) break;
          push({ entry, archive });
        }
      }
      if (model) {
        for (const variant of hdVariants(model.found, model.index))
          push(variant);
      }
      return result;
    };

    const pieces = new Map();
    const unresolved = new Map();
    const placements = [];
    for (const record of selected.values()) {
      const { ymap, entity } = record;
      const archetypeHash = parseHash(entity.archetypeHash);
      const archetype =
        archetypeHash === null ? null : archetypes.get(archetypeHash);
      const level = LOD_BUNDLE[entity.lodLevel];
      const assetHash = parseHash(archetype?.assetHash) ?? archetypeHash;
      const txdHash = parseHash(archetype?.textureDictionaryHash);
      let piece = null;
      if (archetype?.assetType === "drawabledictionary") {
        const ddictHash = parseHash(archetype.drawableDictionaryHash);
        const found =
          files.findHash(ddictHash, ".ydd") ||
          global.findHash(ddictHash, ".ydd");
        if (found) {
          piece = {
            key: `${stemOf(found.entry)}:${hex(assetHash)}`,
            kind: "ydd",
            entry: found.entry,
            archive: found.archive,
            drawableHash: hex(assetHash),
            bundle: level === "hd" ? "near" : "lod",
            dictionaries: dictionaryChain({
              txdHash,
              model: null,
              preferred: files,
            }),
          };
        }
      } else if (assetHash !== null) {
        let model = null;
        let bundle = level;
        for (const [index, name] of [
          [files, "district"],
          [global, "props"],
        ]) {
          for (const extension of MODEL_EXTENSIONS) {
            const found = index.findHash(assetHash, extension);
            if (found) {
              model = { found, index };
              if (level === "hd") {
                bundle =
                  name === "props"
                    ? "props"
                    : isSectionEntry(found.entry)
                      ? "hd"
                      : "near";
              }
              break;
            }
          }
          if (model) break;
        }
        if (model) {
          piece = {
            key: stemOf(model.found.entry),
            kind: extensionOf(model.found.entry).slice(1),
            entry: model.found.entry,
            archive: model.found.archive,
            drawableHash: null,
            bundle,
            dictionaries: dictionaryChain({
              txdHash,
              model,
              preferred: model.index === global ? null : files,
            }),
          };
        }
      }
      if (!piece) {
        const known = unresolved.get(entity.archetypeHash) || {
          archetypeHash: entity.archetypeHash,
          lodLevel: entity.lodLevel,
          count: 0,
          known: Boolean(archetype),
        };
        known.count += 1;
        unresolved.set(entity.archetypeHash, known);
        continue;
      }
      if (!pieces.has(piece.key)) {
        pieces.set(piece.key, {
          ...piece,
          archetype: {
            hash: entity.archetypeHash,
            known: Boolean(archetype),
            lodDist: finite(archetype?.lodDist),
            hdTextureDist: finite(archetype?.hdTextureDist),
            bsRadius: finite(archetype?.bsRadius),
            bsCenter: archetype?.bsCenter || { x: 0, y: 0, z: 0 },
            bbMin: archetype?.bbMin || { x: 0, y: 0, z: 0 },
            bbMax: archetype?.bbMax || { x: 0, y: 0, z: 0 },
            textureDictionary: archetype?.textureDictionaryHash || null,
            timeFlags: archetype?.timeFlags ?? null,
            flags: finite(archetype?.flags),
          },
          placements: 0,
        });
      }
      const stored = pieces.get(piece.key);
      stored.placements += 1;
      placements.push({
        id: record.id,
        ymap: stemOf(ymap.input),
        index: entity.index,
        piece: piece.key,
        bundle: stored.bundle,
        lodLevel: entity.lodLevel,
        lodDist: finite(entity.lodDist, -1),
        childLodDist: finite(entity.childLodDist),
        numChildren: finite(entity.numChildren),
        parent: record.parent,
        flags: finite(entity.flags),
        /* Позиция и кватернион — СЫРЫЕ координаты игры (Z вверх), в мире.
           Перенос к якорю и конверсию осей делает web-сцена в одном месте. */
        position: {
          x: finite(entity.position?.x),
          y: finite(entity.position?.y),
          z: finite(entity.position?.z),
        },
        rotation: {
          x: finite(entity.rotation?.x),
          y: finite(entity.rotation?.y),
          z: finite(entity.rotation?.z),
          w: finite(entity.rotation?.w, 1),
        },
        scale: {
          xy: finite(entity.scale?.xy, 1),
          z: finite(entity.scale?.z, 1),
        },
      });
    }

    /* Порядок детерминирован: по ключу детали и по id сущности — манифест
       от запуска к запуску байт в байт одинаков. */
    const pieceList = [...pieces.values()].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
    placements.sort((left, right) => left.id.localeCompare(right.id));

    const archives = {};
    for (const piece of pieceList) {
      archives[piece.entry] = piece.archive;
      for (const dictionary of piece.dictionaries)
        archives[dictionary.entry] = dictionary.archive;
    }
    const bundles = MEGA_MALL_SECTION_BUNDLES.map((bundleId) => {
      const own = pieceList.filter((piece) => piece.bundle === bundleId);
      const dictionaries = [];
      for (const piece of own) {
        for (const dictionary of piece.dictionaries) {
          if (!dictionaries.includes(dictionary.entry))
            dictionaries.push(dictionary.entry);
        }
      }
      return {
        id: bundleId,
        pieces: own.map((piece) => piece.key),
        dictionaries,
        placements: placements.filter((item) => item.bundle === bundleId)
          .length,
        textures: BUNDLE_TEXTURES[bundleId],
      };
    });
    const byLevel = {};
    for (const placement of placements)
      byLevel[placement.lodLevel] = (byLevel[placement.lodLevel] || 0) + 1;
    lap("total", startedAt);

    return {
      format: "astral.mega-mall-section",
      version: 1,
      status: "ready",
      sectionId,
      label: section.label,
      key,
      archive: section.archive,
      sharedArchive: section.sharedArchive,
      anchor: section.anchor,
      radius: section.radius,
      pieces: pieceList.map((piece) => ({
        key: piece.key,
        kind: piece.kind,
        entry: piece.entry,
        archive: piece.archive,
        drawableHash: piece.drawableHash,
        bundle: piece.bundle,
        archetype: piece.archetype,
        dictionaries: piece.dictionaries.map((item) => item.entry),
        placements: piece.placements,
      })),
      placements,
      bundles,
      archives,
      unresolved: [...unresolved.values()].sort(
        (left, right) => right.count - left.count,
      ),
      stats: {
        ymaps: ymaps.length,
        ytyps: ytyps.length,
        propYtyps: propYtyps.size,
        archetypes: archetypes.size,
        selected: selected.size,
        pieces: pieceList.length,
        placements: placements.length,
        byLevel,
        unresolved: [...unresolved.values()].reduce(
          (sum, item) => sum + item.count,
          0,
        ),
        brokenFiles: broken.length,
        timings,
      },
    };
  };

  /* ---------- манифест с кэшем ---------- */

  const manifestFlights = new Map();
  const ensureManifest = async (
    sectionId,
    targetId,
    { rebuild = false } = {},
  ) => {
    const section = sections[sectionId];
    if (!section) throw new RangeError(`Неизвестная секция: ${sectionId}.`);
    const gameRoot = await resolveGameRoot(targetId);
    if (!gameRoot) {
      return {
        status: "unavailable",
        reason: "Установленная GTA V не найдена.",
      };
    }
    const archivePath = path.join(gameRoot, section.archive);
    const sharedArchivePath = path.join(gameRoot, section.sharedArchive);
    let key = null;
    try {
      key = await cacheKey(sectionId, [archivePath, sharedArchivePath]);
    } catch {
      return {
        status: "unavailable",
        reason: `Архивы ${section.archive} и ${section.sharedArchive} не найдены в папке игры.`,
      };
    }
    const directory = path.join(cacheRoot, `section-${sectionId}-${key}`);
    const manifestFile = path.join(directory, "manifest.json");
    if (rebuild) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    } else {
      try {
        const cached = JSON.parse(await fs.readFile(manifestFile, "utf8"));
        if (
          cached?.status === "ready" &&
          cached.version === 1 &&
          Array.isArray(cached.pieces)
        ) {
          return { manifest: cached, gameRoot, directory, key };
        }
      } catch {
        /* Нет кэша или он битый — пересобираем. */
      }
    }
    const flightKey = `${sectionId}|${key}`;
    if (!manifestFlights.has(flightKey)) {
      const flight = (async () => {
        const manifest = await buildManifest({
          sectionId,
          section,
          gameRoot,
          key,
        });
        await writeCached(manifestFile, JSON.stringify(manifest)).catch(
          () => {},
        );
        return manifest;
      })();
      flight.catch(() => {}).finally(() => manifestFlights.delete(flightKey));
      manifestFlights.set(flightKey, flight);
    }
    try {
      const manifest = await manifestFlights.get(flightKey);
      return { manifest, gameRoot, directory, key };
    } catch (error) {
      return { status: "failed", reason: String(error?.message || error) };
    }
  };

  /* ---------- бандлы ---------- */

  /*
   * Бандл из кэша. `head` — только сведения: размер из stat, хэш из отчёта,
   * файл в память не поднимается. Прогрев четырёх бандлов иначе читал бы
   * с диска сотню мегабайт ради четырёх строк ответа.
   */
  const readCachedBundle = async (
    directory,
    bundleId,
    { head = false } = {},
  ) => {
    try {
      const glbPath = path.join(directory, `${bundleId}.glb`);
      const report = JSON.parse(
        await fs.readFile(path.join(directory, `${bundleId}.json`), "utf8"),
      );
      if (head && typeof report?.sha256 === "string" && report.sha256) {
        const stat = await fs.stat(glbPath);
        if (!stat.size || stat.size > MAX_BUNDLE_BYTES) return null;
        return { glb: null, size: stat.size, report };
      }
      const glb = await fs.readFile(glbPath);
      if (!glb.length || glb.length > MAX_BUNDLE_BYTES) return null;
      return { glb, size: glb.length, report };
    } catch {
      return null;
    }
  };

  const bundleFlights = new Map();
  const buildBundle = ({
    sectionId,
    manifest,
    gameRoot,
    directory,
    bundleId,
  }) => {
    const flightKey = `${sectionId}|${manifest.key}|${bundleId}`;
    if (!bundleFlights.has(flightKey)) {
      const flight = (async () => {
        const section = sections[sectionId];
        const bundle = manifest.bundles.find((item) => item.id === bundleId);
        if (!bundle) throw new RangeError(`Неизвестный бандл: ${bundleId}.`);
        const pieces = manifest.pieces.filter(
          (piece) => piece.bundle === bundleId,
        );
        if (!pieces.length) {
          throw new Error(`В секции нет деталей для бандла ${bundleId}.`);
        }
        const archiveOf = (entry) =>
          manifest.archives?.[entry] ||
          (entry.toLowerCase().startsWith(section.sharedPack.toLowerCase())
            ? section.sharedArchive
            : section.archive);
        const workspace = await fs.mkdtemp(
          path.join(tempRoot, "astral-mall-bundle-"),
        );
        try {
          /* Одна распаковка на архив: детали и словари могут лежать в
             десятке архивов (пропы), но каждый открывается один раз. */
          const byArchive = new Map();
          const want = (archive, entry) => {
            if (!byArchive.has(archive)) byArchive.set(archive, new Set());
            byArchive.get(archive).add(entry);
          };
          for (const piece of pieces)
            want(piece.archive || archiveOf(piece.entry), piece.entry);
          for (const entry of bundle.dictionaries)
            want(archiveOf(entry), entry);
          const produced = new Map();
          for (const [archive, entries] of byArchive) {
            const extracted = await extractEntries({
              archivePath: path.join(gameRoot, archive),
              entries: [...entries],
              outputDirectory: path.join(workspace, stemOf(archive)),
              gameRoot,
            });
            for (const item of extracted?.extracted || []) {
              produced.set(
                `${archive}|${String(item.entry).toLowerCase()}`,
                String(item.output),
              );
            }
          }
          const fileFor = (archive, entry) => {
            const file = produced.get(`${archive}|${entry.toLowerCase()}`);
            if (!file)
              throw new Error(`Не удалось извлечь ${entry} из ${archive}.`);
            return file;
          };
          const request = {
            format: "astral.convert-scene",
            version: 1,
            pieces: pieces.map((piece) => ({
              id: piece.key,
              file: fileFor(
                piece.archive || archiveOf(piece.entry),
                piece.entry,
              ),
              drawableHash: piece.drawableHash || undefined,
            })),
            textures: bundle.dictionaries.map((entry) =>
              fileFor(archiveOf(entry), entry),
            ),
            ...(bundle.textures ||
              BUNDLE_TEXTURES[bundleId] ||
              BUNDLE_TEXTURES.hd),
            textureFormat: "auto",
            jpegQuality: 86,
            vertexColors: true,
            lods: true,
          };
          const requestFile = path.join(workspace, `${bundleId}-request.json`);
          const outputFile = path.join(workspace, `${bundleId}.glb`);
          await fs.writeFile(requestFile, JSON.stringify(request));
          const report = await convertScene({
            input: requestFile,
            output: outputFile,
          });
          const glb = await fs.readFile(String(report?.output || outputFile));
          if (!glb.length || glb.length > MAX_BUNDLE_BYTES) {
            throw new Error(
              `Бандл ${bundleId} вернулся недопустимого размера: ${glb.length} байт.`,
            );
          }
          const compact = {
            format: "astral.mega-mall-section-bundle",
            version: 1,
            bundleId,
            bytes: glb.length,
            sha256: sha256Hex(glb),
            options: report?.options || null,
            materials: finite(report?.materials),
            triangles: finite(report?.triangles),
            vertices: finite(report?.vertices),
            imageBytes: finite(report?.imageBytes),
            images: (report?.images || []).map((image) => ({
              name: image.name,
              width: image.width,
              height: image.height,
              bytes: image.bytes,
              mime: image.mime,
            })),
            pieces: (report?.pieces || []).map((piece) => ({
              id: piece.id,
              ok: Boolean(piece.ok),
              error: piece.error || null,
              lods: piece.lods || [],
              boundsMin: piece.boundsMin || null,
              boundsMax: piece.boundsMax || null,
              sphereCenter: piece.sphereCenter || null,
              sphereRadius: finite(piece.sphereRadius),
              lights: piece.lights || [],
              missingTextures: piece.missingTextures || [],
              shaders: piece.shaders || [],
            })),
            builtAt: new Date().toISOString(),
          };
          await writeCached(path.join(directory, `${bundleId}.glb`), glb);
          await writeCached(
            path.join(directory, `${bundleId}.json`),
            JSON.stringify(compact),
          );
          return { glb, report: compact };
        } finally {
          await fs
            .rm(workspace, { recursive: true, force: true })
            .catch(() => {});
        }
      })();
      flight.catch(() => {}).finally(() => bundleFlights.delete(flightKey));
      bundleFlights.set(flightKey, flight);
    }
    return bundleFlights.get(flightKey);
  };

  return Object.freeze({
    sections() {
      return Object.keys(sections);
    },

    async manifest({
      sectionId = "davis-mega-mall",
      targetId,
      rebuild = false,
    } = {}) {
      const resolved = await ensureManifest(sectionId, targetId, { rebuild });
      return resolved.manifest || resolved;
    },

    /*
     * Бандл: байты GLB и отчёт.
     *
     * `head: true` — только сведения (хэш, размер, отчёт) без байтов: так
     * греет кэш фоновый прогрев. `ifNoneMatch` — хэш бандла, который у
     * вызывающего уже разобран: сцена держит бандлы в памяти между
     * открытиями редактора, и совпавший хэш означает ответ без байтов
     * (`unchanged: true`) — десятки мегабайт не едут через IPC зря. Бандла
     * ещё нет — он собирается в любом режиме: следующий запрос уже не ждёт.
     */
    async bundle({
      sectionId = "davis-mega-mall",
      targetId,
      bundleId = "hd",
      head = false,
      ifNoneMatch = "",
    } = {}) {
      if (!MEGA_MALL_SECTION_BUNDLES.includes(bundleId)) {
        throw new RangeError(`Неизвестный бандл секции: ${bundleId}.`);
      }
      const resolved = await ensureManifest(sectionId, targetId);
      if (!resolved.manifest) return resolved;
      const { manifest, gameRoot, directory } = resolved;
      const answer = ({ cached: fromDisk, bytes, sha256, glb, report }) => {
        const unchanged = Boolean(ifNoneMatch) && ifNoneMatch === sha256;
        return {
          status: "ready",
          sectionId,
          bundleId,
          cached: fromDisk,
          bytes,
          sha256,
          unchanged,
          glb: head || unchanged ? null : glb,
          report,
        };
      };
      /* Хэш известен наперёд — байты с диска не нужны ни в одном из ответов. */
      const light = head || Boolean(ifNoneMatch);
      let cached = await readCachedBundle(directory, bundleId, { head: light });
      if (cached && !cached.glb && !head) {
        const sha256 = cached.report.sha256;
        if (ifNoneMatch !== sha256) {
          cached = await readCachedBundle(directory, bundleId);
        }
      }
      if (cached) {
        return answer({
          cached: true,
          bytes: cached.size,
          sha256: cached.report.sha256 || sha256Hex(cached.glb),
          glb: cached.glb,
          report: cached.report,
        });
      }
      const declared = manifest.bundles.find((item) => item.id === bundleId);
      if (!declared || !declared.pieces.length) {
        return {
          status: "empty",
          sectionId,
          bundleId,
          reason: `В секции нет деталей для бандла ${bundleId}.`,
        };
      }
      try {
        const built = await buildBundle({
          sectionId,
          manifest,
          gameRoot,
          directory,
          bundleId,
        });
        return answer({
          cached: false,
          bytes: built.glb.length,
          sha256: built.report.sha256,
          glb: built.glb,
          report: built.report,
        });
      } catch (error) {
        return { status: "failed", reason: String(error?.message || error) };
      }
    },

    /*
     * Прогрев кэша в фоне: манифест и бандлы собираются заранее — например,
     * когда человек открыл Мастерскую, но до плитки молла ещё не дошёл.
     * Байты наружу не отдаются, бандлы собираются параллельно (распаковка
     * и так стоит в очереди rpf-хелпера, конвертеры идут рядом). Провал
     * одного бандла не роняет остальные: результат — по каждому отдельно.
     */
    async warm({
      sectionId = "davis-mega-mall",
      targetId,
      bundleIds = MEGA_MALL_SECTION_BUNDLES,
    } = {}) {
      const wanted = [...new Set(bundleIds)].filter((bundleId) =>
        MEGA_MALL_SECTION_BUNDLES.includes(bundleId),
      );
      const resolved = await ensureManifest(sectionId, targetId);
      if (!resolved.manifest) return resolved;
      const results = await Promise.all(
        wanted.map(async (bundleId) => {
          const result = await this.bundle({
            sectionId,
            targetId,
            bundleId,
            head: true,
          });
          return [
            bundleId,
            {
              status: result.status,
              cached: result.cached ?? null,
              bytes: result.bytes ?? 0,
              sha256: result.sha256 ?? null,
              reason: result.reason ?? "",
            },
          ];
        }),
      );
      return {
        status: "ready",
        sectionId,
        key: resolved.manifest.key,
        bundles: Object.fromEntries(results),
      };
    },
  });
}
