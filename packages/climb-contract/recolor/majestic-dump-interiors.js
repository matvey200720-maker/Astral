/*
 * «Интерьеры Majestic RP» — остальные интерьеры выгрузки владельца (ТЗ 29.10.2026-e, п. 3).
 *
 * Выгрузка `Majestic_Dump.rar` несёт 74 интерьера; реестр двенадцати (`majestic-interiors.js`) берёт из неё казино, службы и государство. Здесь —
 * все остальные места: банды, гаражи, заведения, магазины и прочее. Паков на CDN Astral у них нет (чужой контент Majestic без разрешения на CDN не
 * кладём): файлы берутся только из папки игрока (`ownerOnly`), как у казино; у тестера без файлов открывается слово «укажите папку». Режим один —
 * `sheets`: правка по самим листам (`majestic-sheets.js`), без цвета и блеска поверхностей: у них нет ни обложек, ни описи поверхностей.
 *
 * Номер интерьера — `p<8 hex>`: наименьший хеш MLO пака (`project-interiors.js`); сверен с выгрузкой `scripts/probe-majestic-dump.mjs`. Подписи
 * взяты у папки пака (латиницей, как зовут место на сервере, где это известно): полного перечня названий у владельца нет, спорные —
 * «по имени папки». Три пака `mj_hw_addon`, три `q_rancho_full` и два `replace` одноимённые — различаются номером.
 */

export const MAJESTIC_DUMP_GROUPS = Object.freeze([
  Object.freeze({ id: "gangs", label: "Банды и районы" }),
  Object.freeze({ id: "garages", label: "Гаражи" }),
  Object.freeze({ id: "places", label: "Заведения и магазины" }),
  Object.freeze({ id: "other", label: "Прочее" }),
]);

const owned = (id, label, group, unit) => Object.freeze({ id, label, group, mode: "sheets", ownerOnly: true, packs: Object.freeze([Object.freeze({ slug: "", unit, role: "main" })]) });

export const MAJESTIC_DUMP_INTERIORS = Object.freeze([
  /* Банды и районы */
  owned("bloods", "Bloods", "gangs", "p21b65eea"),
  owned("marabunta", "Marabunta", "gangs", "p29b3ae9c"),
  owned("ballas-panic", "Ballas Panic Room", "gangs", "p308c8645"),
  owned("families", "Families", "gangs", "p670dcf75"),
  owned("vagos", "Vagos", "gangs", "p5e7a9c85"),
  owned("armenian-mafia", "Armenian Mafia", "gangs", "p0b652047"),
  owned("russian-mafia", "Russian Mafia", "gangs", "p07a85fc5"),
  owned("lost-mc", "Lost MC", "gangs", "pf1d3c36a"),
  /* Службы и государство */
  owned("pillbox", "Pillbox Hospital", "services", "pbe3b6df7"),
  owned("courthouse", "Courthouse", "state", "pf5d5e1aa"),
  /* Город */
  owned("maze-arena", "Maze Bank Arena", "city", "p3064477c"),
  owned("festival", "Majestic Festival", "city", "p22428f46"),
  /* Гаражи */
  owned("garage-14", "Garage 14", "garages", "pae36ffdc"),
  owned("garage-x8", "Garage X8", "garages", "pe813ef65"),
  owned("garage-100", "Garage 100", "garages", "pe2c049eb"),
  owned("garage-h10", "Garage H-10", "garages", "pe21b33f0"),
  owned("garage-l10", "Garage L-10", "garages", "pbfa9ea95"),
  owned("garage-gcity", "Garage L-5 GCity", "garages", "p812247e1"),
  owned("garage-gse", "Garage L-5 GSE", "garages", "pd7680bc9"),
  owned("garage-mh16", "Garage MH-16", "garages", "p49fef63d"),
  owned("majestic-garage-2-4", "Majestic Garage 2-4", "garages", "p6ae8b79c"),
  owned("majestic-garage-2-6", "Majestic Garage 2-6", "garages", "p744b4547"),
  /* Заведения и магазины */
  owned("bahama-mamas", "Bahama Mamas", "places", "pde39e103"),
  owned("church", "Church", "places", "p65356557"),
  owned("tc-main", "TC Main", "places", "p04db28be"),
  owned("ammo-room", "Ammo Room", "places", "p9a9e7880"),
  owned("christmas-starthouse", "Christmas Star House", "places", "pb015247e"),
  owned("taxi", "Taxi Company", "places", "p3f569653"),
  owned("harmony", "Harmony Repair", "places", "pc02fe51d"),
  owned("hayes", "Hayes Auto", "places", "p6f1fb9bb"),
  owned("unicorn", "Vanilla Unicorn", "places", "p4e55a04e"),
  owned("store-247", "24/7 Store", "places", "p9b39307b"),
  owned("liquor-store", "Liquor Store", "places", "p4fcb840e"),
  owned("gun-store", "Gun Store", "places", "pfe693a97"),
  owned("leopolds", "Leopold's", "places", "p83dfc6c4"),
  owned("lifeinvader", "Lifeinvader", "places", "p8c0e879b"),
  owned("maj-fish", "Maj Fish", "places", "p256e7e7b"),
  owned("majestic-motors", "Majestic Motors", "places", "pbdbf0909"),
  owned("auction", "Auction House", "places", "p0e5e12c0"),
  owned("bookmaker", "Bookmaker", "places", "p4d55f589"),
  owned("callisto", "Callisto", "places", "p0a1b74fa"),
  owned("carshow", "Car Show", "places", "p10016e3f"),
  owned("diner", "Diner", "places", "pcdabe802"),
  owned("mining", "Mining", "places", "p4448681b"),
  owned("playboy", "Playboy Mansion", "places", "p1d17ef0f"),
  owned("mansion", "Mansion", "places", "p79f2b525"),
  owned("hunt-shop", "Hunt Shop", "places", "p476b2437"),
  owned("standup", "Stand-up Club", "places", "p0a1e39f8"),
  owned("university", "University", "places", "p0a5c1450"),
  /* Прочее */
  owned("fix-vanilla", "Fix Vanilla Interiors", "other", "p07035337"),
  owned("fix-lester", "Lester Fix", "other", "p32f13d84"),
  owned("xmas-2024", "Xmas 2024", "other", "p3036f5d2"),
  owned("hw-addon-1", "HW Addon 1", "other", "p6acc1a25"),
  owned("hw-addon-2", "HW Addon 2", "other", "p75faff4d"),
  owned("hw-addon-3", "HW Addon 3", "other", "pcdbf5c95"),
  owned("rancho-1", "Rancho 1", "other", "p8bb336a4"),
  owned("rancho-2", "Rancho 2", "other", "paac484eb"),
  owned("rancho-3", "Rancho 3", "other", "p2f6587dd"),
  owned("replace-1", "Replace 1", "other", "p0d5520ef"),
  owned("replace-2", "Replace 2", "other", "p2e507072"),
  owned("v-int-32", "V Int 32", "other", "pcaa42180"),
]);

/** Запись по `id` или `null`. */
export const majesticDumpInteriorById = (id) => MAJESTIC_DUMP_INTERIORS.find((entry) => entry.id === id) || null;
