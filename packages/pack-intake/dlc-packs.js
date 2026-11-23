/*
 * DLC-паки в архиве поста — целиком (задача 5 ТЗ 08.10, вечер).
 *
 * Разбор узнавал паки только по имени файла (`dlc.rpf`, `update.rpf`), а их
 * паспорта — `setup2.xml`, `content.xml`, `dlclist.xml` — не читал вовсе.
 * Между тем по ним игра и подключает пак, и по ним же видно, что внутри:
 * одежда (магазин `SHOP_PED_APPAREL_META_FILE`, коллекции педов), оружие
 * (`WEAPONINFO_FILE`), машины (`VEHICLE_METADATA_FILE`, `HANDLING_FILE`),
 * карта (`DLC_ITYP_REQUEST`, ymap/ytyp), тату (`PED_OVERLAY_FILE`), звук.
 *
 * Пак — папка с `setup2.xml` в корне, где бы она ни лежала:
 *   • `dlcpacks/<имя>/dlc.rpf/setup2.xml` — как кладёт игра;
 *   • `<своё имя>.rpf/setup2.xml` — пак, переименованный автором;
 *   • распакованная папка (`mods/clothes/mypack/setup2.xml`, `Addon/…`).
 * `dlclist.xml` (где бы ни нашёлся) говорит, какие из них зарегистрированы.
 *
 * Здесь только чтение и описание, без зависимостей: заявку работника
 * (`pathKinds` — по путям, дёшево), разбор одежды, отчёт импорта и окно
 * кормит одно и то же.
 */

const forward = (value) => String(value || "").replace(/\\/g, "/");
const lower = (value) => forward(value).toLowerCase();

const tag = (source, name) =>
  source.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, "i"))?.[1] ??
  null;

/* Тексты `<Item>…</Item>` во всех блоках `<block>…</block>`. */
const itemsOf = (source, block) => {
  const out = [];
  for (const chunk of String(source).match(
    new RegExp(`<${block}>([\\s\\S]*?)</${block}>`, "gi"),
  ) || [])
    for (const match of chunk.matchAll(/<Item>\s*([^<]+?)\s*<\/Item>/gi))
      out.push(match[1].trim());
  return out;
};

/** `setup2.xml` пака: имя, устройство, тип, порядок, наборы изменений. */
export function parseSetup2(text) {
  const source = String(text || "");
  const nameHash = tag(source, "nameHash");
  const deviceName = tag(source, "deviceName");
  if (!nameHash && !deviceName) return null;
  const groups =
    source.match(
      /<contentChangeSetGroups>([\s\S]*?)<\/contentChangeSetGroups>/i,
    )?.[1] || "";
  return {
    nameHash: nameHash || null,
    deviceName: deviceName || null,
    type: tag(source, "type"),
    order: Number(source.match(/<order\s+value="(-?\d+)"/i)?.[1]) || null,
    datFile: tag(source, "datFile"),
    timeStamp: tag(source, "timeStamp"),
    groups: [...groups.matchAll(/<NameHash>\s*([^<]+?)\s*<\/NameHash>/gi)].map(
      (match) => match[1],
    ),
    changeSets: [...new Set(itemsOf(source, "ContentChangeSets"))],
  };
}

/**
 * `content.xml` пака целиком: файлы данных с типами, наборы изменений и что
 * они включают. Пути — как в файле (`dlc_mypack:/common/data/…`).
 */
export function parseContentXml(text) {
  const source = String(text || "");
  const dataFiles = [];
  const block = source.match(/<dataFiles>([\s\S]*?)<\/dataFiles>/i)?.[1] || "";
  for (const match of block.matchAll(/<Item>([\s\S]*?)<\/Item>/gi)) {
    const body = match[1];
    const filename = tag(body, "filename");
    if (!filename) continue;
    dataFiles.push({
      filename: forward(filename),
      fileType: tag(body, "fileType") || "",
      overlay: /<overlay\s+value="true"/i.test(body),
      disabled: /<disabled\s+value="true"/i.test(body),
      persistent: /<persistent\s+value="true"/i.test(body),
    });
  }
  const changeSets = [];
  const sets =
    source.match(/<contentChangeSets>([\s\S]*?)<\/contentChangeSets>/i)?.[1] ||
    "";
  for (const match of sets.matchAll(
    /<Item>\s*<changeSetName>([\s\S]*?)<\/changeSetName>([\s\S]*?)(?=<Item>\s*<changeSetName>|$)/gi,
  ))
    changeSets.push({
      name: match[1].trim(),
      filesToEnable: itemsOf(match[2], "filesToEnable").map(forward),
      filesToDisable: itemsOf(match[2], "filesToDisable").map(forward),
    });
  const filesToEnable = [
    ...new Set(itemsOf(source, "filesToEnable").map(forward)),
  ];
  return { dataFiles, changeSets, filesToEnable };
}

/** Паки в `dlclist.xml` по порядку загрузки: `dlcpacks:/mypack/` → `mypack`. */
export function parseDlcList(text) {
  return [
    ...String(text || "").matchAll(
      /<Item>\s*(?:platform:[\\/]+dlcpacks|dlcpacks:)[\\/]+([^\\/<\s]+)/gi,
    ),
  ].map((match) => match[1].toLowerCase());
}

/*
 * Паки Rockstar — их вещи штатные: mpapartment, mpheist4, patchday27ng,
 * spupgrade, а с 2023-го — с подчёркиванием (mp2023_01, mp2024_02,
 * patch2024_01) и с хвостом g9ec у Enhanced (mpchristmas3_g9ec,
 * patchdayg9ecng).
 */
export const ROCKSTAR_PACK =
  /^(?:mp[a-z]*\d*[a-z]*|mp\d{4}_\d{2}|patchday[a-z0-9]*|patch\d{4}_\d{2}|spupgrade)(?:_g9ec)?$/i;

export const isRockstarPack = (name) => ROCKSTAR_PACK.test(String(name || ""));

/*
 * Как дополнения называют игроки (перенесено из `game-clothing-index.js`:
 * одна таблица на оглавление одежды игры и на разбор импорта). Что не
 * названо здесь, показывается по имени папки.
 */
export const DLC_TITLES = Object.freeze({
  mpapartment: "Квартиры",
  mpairraces: "Воздушные гонки",
  mpassault: "Штурм",
  mpbattle: "Битва",
  mpbeach: "Пляж",
  mpbiker: "Байкеры",
  mpbusiness: "Бизнес",
  mpbusiness2: "Бизнес 2",
  mpchristmas: "Рождество",
  mpchristmas2: "Рождество 2",
  mpchristmas2017: "Рождество 2017",
  mpchristmas2018: "Рождество 2018",
  mpchristmas3: "Рождество 3",
  mpexecutive: "Руководители",
  mpgunrunning: "Торговля оружием",
  mphalloween: "Хэллоуин",
  mpheist: "Ограбления",
  mpheist3: "Ограбление казино",
  mpheist4: "Ограбление Кайо-Перико",
  mphipster: "Хипстеры",
  mpimportexport: "Импорт и экспорт",
  mpindependence: "День независимости",
  mpjanuary2016: "Январь 2016",
  mplowrider: "Лоурайдеры",
  mplowrider2: "Лоурайдеры 2",
  mplts: "Борьба за выживание",
  mpluxe: "Люкс",
  mpluxe2: "Люкс 2",
  mppilot: "Лётчики",
  mpsecurity: "Охрана",
  mpsmuggler: "Контрабандисты",
  mpspecialraces: "Особые гонки",
  mpstunt: "Трюки",
  mpsum: "Лето",
  mpsum2: "Лето 2",
  mptuner: "Тюнинг",
  mpvalentines: "День святого Валентина",
  mpvalentines2: "День святого Валентина 2",
  mpvinewood: "Казино Vinewood",
  mpxmas_604490: "Рождество (бонус)",
});

/** Название дополнения для человека: «Ограбление казино», «Обновление 02.2023». */
export function dlcTitle(pack) {
  const name = String(pack || "").toLowerCase();
  if (DLC_TITLES[name]) return DLC_TITLES[name];
  const dated = /^(?:mp|patch)?(20\d\d)_(\d\d)(_g9ec)?$/.exec(name);
  if (dated) return `Обновление ${dated[2]}.${dated[1]}`;
  const patchday = /^patchday(\d+[a-z0-9]*?)ng$/.exec(name);
  if (patchday) return `Обновление ${patchday[1]}`;
  return name;
}

/* Что за данные, по типу файла `content.xml`. */
const KIND_OF_TYPE = [
  [
    /^SHOP_PED_APPAREL_META_FILE$|^PED_METADATA_FILE$|^PED_COMPONENT_SETS_FILE$/i,
    "clothing",
  ],
  [/^PED_OVERLAY_FILE$|^TATTOO_SHOP_DLC_FILE$/i, "tattoos"],
  [/^WEAPON|^LOADOUTS_FILE$|^PICKUP_DATA_FILE$/i, "weapons"],
  [/^VEHICLE|^HANDLING_FILE$|^CARCOLS_FILE$|^CARVARIATIONS/i, "vehicles"],
  [
    /^DLC_ITYP_REQUEST$|IPL|^SCENARIO|^NAVMESH|^COMBINED_MAP|^DLC_POP_GROUPS|^ZONEBIND/i,
    "map",
  ],
  [/^AUDIO_|SPEECH|SOUNDDATA|SYNTHDATA|GAMEDATA/i, "audio"],
  [/^PED_PERSONALITY_FILE$|^PEDSTREAM|^PED_FILE$/i, "peds"],
];

/* Что за файлы, по пути внутри пака (когда `content.xml` молчит). */
const KIND_OF_PATH = [
  [
    /(?:^|\/)mp_[mf]_freemode_01[^/^]*[/^](?:p_)?[a-z]+_(?:diff_|norm_|normal_|spec_)?\d{3}[^/]*\.(?:ydd|ytd)$/i,
    "clothing",
  ],
  [
    /(?:^|\/)mp_[mf]_freemode_01[^/]*\.ymt$|_shop\.meta$|shop_ped_apparel/i,
    "clothing",
  ],
  [/_overlays\.(?:rpf|xml)$|(?:^|\/)[^/]*tat[^/]*\.ytd$/i, "tattoos"],
  [/(?:^|\/)w_[a-z]{2}_[^/]*\.(?:ydr|ytd|yft)$|weapon[^/]*\.meta$/i, "weapons"],
  [
    /vehicles\.meta$|handling\.meta$|carcols\.meta$|carvariations\.meta$|\.yft$/i,
    "vehicles",
  ],
  [/\.(?:ymap|ytyp|ybn|ynv|ynd)$/i, "map"],
  [/\.(?:awc|rel)$|\.dat\d+(?:\.rel)?$/i, "audio"],
];

/** Вид файла по пути — `clothing`, `weapons`… или `null`. */
export const kindOfPath = (path) =>
  KIND_OF_PATH.find(([pattern]) => pattern.test(forward(path)))?.[1] || null;

/**
 * Паки в дереве архива: каждая папка с `setup2.xml` в корне. Ничего не
 * читает — только раскладывает файлы по пакам.
 *
 * @param {Array<{path: string}>} files
 * @returns {Array<{root: string, name: string, setupPath: string,
 *   contentPath: string|null, container: "dlc.rpf"|"rpf"|"folder",
 *   location: "dlcpacks"|"custom", files: Array<object>}>}
 */
export function findDlcPacks(files = []) {
  const paths = files.map((file) => forward(file.path));
  const roots = paths
    .filter((path) => /(?:^|\/)setup2\.xml$/i.test(path))
    .map((path) => path.slice(0, -"setup2.xml".length).replace(/\/$/, ""))
    /* Самый длинный корень первым: вложенный пак — свой. */
    .sort((left, right) => right.length - left.length);
  const packs = roots.map((root) => {
    const parts = root.split("/");
    const last = parts.at(-1) || "";
    const container = /^dlc\.rpf$/i.test(last)
      ? "dlc.rpf"
      : /\.rpf$/i.test(last)
        ? "rpf"
        : "folder";
    /* Имя: папка над dlc.rpf, имя своего .rpf или распакованная папка. */
    const name = (
      container === "dlc.rpf"
        ? parts.at(-2) || last
        : last.replace(/\.rpf$/i, "")
    ).toLowerCase();
    const location = parts.some((part) => part.toLowerCase() === "dlcpacks")
      ? "dlcpacks"
      : "custom";
    const contentPath =
      paths.find((path) => lower(path) === `${lower(root)}/content.xml`) ||
      null;
    return {
      root,
      name,
      setupPath: root ? `${root}/setup2.xml` : "setup2.xml",
      contentPath,
      container,
      location,
      files: [],
    };
  });
  for (const file of files) {
    const path = lower(file.path);
    const pack = packs.find(
      (item) => !item.root || path.startsWith(`${lower(item.root)}/`),
    );
    if (pack) pack.files.push(file);
  }
  return packs;
}

/**
 * Путь из `content.xml` (`dlc_mypack:/%PLATFORM%/…`) — путь в дереве. Пути
 * игры (`platform:/`, `update:/`) — не файлы пака: `null`.
 */
export function treePathOf(pack, filename) {
  const value = forward(filename);
  const device = /^([a-z0-9_]+):\//i.exec(value);
  if (device && !/^dlc/i.test(device[1])) return null;
  const inner = value
    .replace(/^[a-z0-9_]+:\//i, "")
    .replace(/%platform%/gi, "x64")
    .replace(/^\/+/, "");
  return pack.root ? `${pack.root}/${inner}` : inner;
}

/** Пак, в котором лежит файл дерева, — или `null`. */
export function packOfPath(packs = [], path = "") {
  const value = lower(path);
  return (
    packs
      .filter((pack) => !pack.root || value.startsWith(`${lower(pack.root)}/`))
      .sort((left, right) => right.root.length - left.root.length)[0] || null
  );
}

/**
 * Виды содержимого паков — только по путям, без чтения: для `claim`
 * работников. `[{ root, name, rockstar, kinds: { clothing: 12, … } }]`.
 */
export function pathKinds(files = []) {
  return findDlcPacks(files).map((pack) => {
    const kinds = {};
    for (const file of pack.files) {
      const kind = kindOfPath(file.path);
      if (kind) kinds[kind] = (kinds[kind] || 0) + 1;
    }
    return {
      root: pack.root,
      name: pack.name,
      rockstar: isRockstarPack(pack.name),
      kinds,
      files: pack.files,
    };
  });
}

async function readText(file) {
  if (!file?.read) return "";
  const bytes = await file.read();
  return new TextDecoder().decode(bytes);
}

/* Человеку: что в паке, словами. */
const KIND_WORDS = {
  clothing: "одежда",
  tattoos: "тату",
  weapons: "оружие",
  vehicles: "машины",
  map: "карта",
  audio: "звук",
  peds: "персонажи",
};

const plural = (count, one, few, many) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

/** «DLC «mypack» (dlcpacks, в dlclist): одежда — 12 вещей, 2 коллекции; машины». */
export function dlcPackSummary(pack) {
  const parts = [];
  for (const [kind, amount] of Object.entries(pack.kinds || {})) {
    if (kind === "clothing" && pack.clothing?.items) {
      const { items, collections } = pack.clothing;
      parts.push(
        `одежда — ${items} ${plural(items, "вещь", "вещи", "вещей")}${
          collections.length
            ? `, ${collections.length} ${plural(collections.length, "коллекция", "коллекции", "коллекций")}`
            : ""
        }${pack.clothing.addon ? " (свои, новые)" : ""}`,
      );
      continue;
    }
    const word = KIND_WORDS[kind] || kind;
    parts.push(
      amount > 0
        ? `${word} — ${amount} ${plural(amount, "файл", "файла", "файлов")}`
        : word,
    );
  }
  const where = [
    pack.location === "dlcpacks"
      ? "dlcpacks"
      : pack.container === "folder"
        ? "распакованная папка"
        : "свой .rpf",
    pack.registered ? "в dlclist" : null,
    pack.rockstar ? `пак Rockstar «${dlcTitle(pack.name)}»` : null,
  ].filter(Boolean);
  const problems = pack.problems?.length ? ` · ${pack.problems.join(", ")}` : "";
  return `DLC «${pack.name}» (${where.join(", ")}): ${parts.join("; ") || "состав не узнан"}${problems}`;
}

/* `.ymt` коллекции: `mp_m_freemode_01[_p][_коллекция].ymt`. */
const YMT = /(?:^|\/)(mp_[mf]_freemode_01)(_p)?(?:_([a-z0-9_]+))?\.ymt$/i;

/* Папка педа вещи: `mp_m_freemode_01[_p][_коллекция]` в пути или в FiveM-имени. */
const PED_ITEM =
  /(?:^|\/)(mp_[mf]_freemode_01)(_p)?(?:_([a-z0-9_]+?))?[/^]((?:p_)?[a-z]+)_(\d{3})(?:_[ur])?\.ydd$/i;

/**
 * Описание паков архива: паспорт (`setup2.xml`), состав по `content.xml` и
 * по файлам, регистрация в `dlclist.xml`, коллекции одежды.
 *
 * @param {Array<{path: string, read?: Function}>} files дерево pack-intake
 * @returns {Promise<{packs: Array<object>, dlclist: string[]}>}
 */
export async function describeDlcPacks(files = []) {
  const byPath = new Map(files.map((file) => [lower(file.path), file]));
  const dlclist = [];
  for (const file of files) {
    if (!/(?:^|\/)dlclist\.xml$/i.test(forward(file.path))) continue;
    try {
      dlclist.push(...parseDlcList(await readText(file)));
    } catch {
      /* битый список — паки остаются незарегистрированными */
    }
  }
  const packs = [];
  for (const found of findDlcPacks(files)) {
    let setup = null;
    let content = null;
    const problems = [];
    try {
      setup = parseSetup2(await readText(byPath.get(lower(found.setupPath))));
      if (!setup) problems.push("setup2.xml без имени пака");
    } catch {
      problems.push("setup2.xml не читается");
    }
    if (found.contentPath)
      try {
        content = parseContentXml(
          await readText(byPath.get(lower(found.contentPath))),
        );
      } catch {
        problems.push("content.xml не читается");
      }
    else problems.push("нет content.xml");
    const name = String(setup?.nameHash || found.name || "").toLowerCase();
    const rockstar = isRockstarPack(name);
    /* Виды: по файлам (сколько) и по `content.xml` (объявлено — 0, если
       файлов этого вида по путям не нашлось: модели бывают в другом .rpf). */
    const kinds = {};
    for (const file of found.files) {
      const kind = kindOfPath(file.path);
      if (kind) kinds[kind] = (kinds[kind] || 0) + 1;
    }
    for (const item of content?.dataFiles || []) {
      const kind = KIND_OF_TYPE.find(([pattern]) =>
        pattern.test(item.fileType),
      )?.[1];
      if (kind && !(kind in kinds)) kinds[kind] = 0;
    }
    /* Одежда: вещи (модели) по коллекциям педов. */
    const collections = new Map();
    const items = new Set();
    for (const file of found.files) {
      const match = PED_ITEM.exec(forward(file.path));
      if (!match) continue;
      const collection = (match[3] || "").toLowerCase() || null;
      const folder =
        `${match[1]}${match[2] || ""}${collection ? `_${collection}` : ""}`.toLowerCase();
      items.add(`${folder}|${match[4].toLowerCase()}|${match[5]}`);
      const entry = collections.get(folder) || {
        folder,
        gender: /^mp_f_/i.test(folder) ? "female" : "male",
        collection,
        props: Boolean(match[2]),
        items: 0,
      };
      entry.items += 1;
      collections.set(folder, entry);
    }
    const shopMeta = (content?.dataFiles || [])
      .filter((item) => /^SHOP_PED_APPAREL_META_FILE$/i.test(item.fileType))
      .map((item) => treePathOf(found, item.filename))
      .filter(Boolean);
    /* Коллекция, которую пак объявляет сам: её `.ymt` лежит в паке. */
    const declared = new Set();
    for (const file of found.files) {
      const match = YMT.exec(forward(file.path));
      if (match?.[3])
        declared.add(
          `${/^mp_f_/i.test(match[1]) ? "female" : "male"}|${match[3].toLowerCase()}`,
        );
    }
    for (const entry of collections.values())
      entry.registered = Boolean(
        entry.collection &&
          declared.has(
            `${entry.gender}|${entry.collection.replace(/^p_/, "")}`,
          ),
      );
    const pack = {
      root: found.root,
      name,
      title: dlcTitle(name),
      deviceName: setup?.deviceName || null,
      type: setup?.type || null,
      order: setup?.order ?? null,
      container: found.container,
      location: found.location,
      registered: dlclist.includes(name),
      rockstar,
      dataFiles: content?.dataFiles || [],
      changeSets: content?.changeSets || [],
      filesToEnable: content?.filesToEnable || [],
      kinds,
      clothing: {
        items: items.size,
        collections: [...collections.values()],
        shopMeta,
        /* Свои вещи: пак не Rockstar и сам объявляет магазин одежды или
           `.ymt` своей коллекции — значит, вещи в нём новые, а не замена
           (коллекция сервера без своего `.ymt` — замена его вещей). */
        addon:
          !rockstar &&
          (shopMeta.length > 0 ||
            [...collections.values()].some((entry) => entry.registered)),
      },
      files: found.files.length,
      problems,
    };
    pack.summary = dlcPackSummary(pack);
    packs.push(pack);
  }
  return { packs, dlclist: [...new Set(dlclist)] };
}
