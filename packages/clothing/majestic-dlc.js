/*
 * Какие DLC игры грузит клиент Majestic (25.10.2026).
 *
 * Клиент Majestic — свой (`majestic-client.dll`, alt:V), и дополнения игры он
 * монтирует только из белого списка: журнал запуска
 * (`%APPDATA%\majestic-launcher\Multiplayer\logs\client_*.log`, сборка 1.23.30)
 * называет их строками «DLC <имя> added to whitelist», остальные — «Skipping
 * game DLC … (not whitelisted)». Своего пака Astral (`astral_clothing`,
 * `astral_weapons`) в журнале нет вовсе: клиент его не берёт, поэтому замена
 * одежды, записанная в Astral Clothing DLC, на Majestic до игры не доходит —
 * владелец ставил «Бело-оранжевый Bigness · Suburban», а в Suburban оставалась
 * штатная вещь.
 *
 * Значит, на Majestic замена обязана лежать в самом белом паке. Два маршрута:
 *
 * 1. Вещь есть в файлах игры (белый пак) — файлы заменяются там, где вещь
 *    лежит, под её именами. Паки новее списка (`mp2024_02`, `mp2025_*`,
 *    `*_g9ec`) локально заменить нельзя.
 *
 * 2. Вещь серверного пака Majestic (`…_mp_[mf]_clothes_pack0..3`). Файлов у
 *    неё в игре нет: клиент берёт их из своего зашифрованного кэша, поэтому до
 *    01.11.2026 такие вещи считались незаменяемыми. Владелец прислал изменённый
 *    `patchday16ng/dlc.rpf`: моддеры кладут файлы с именем вещи в overlay-RPF
 *    внутри белого пака (`x64/levels/gta5/kitana.rpf/<папка>/<файл>`) и
 *    включают его строками в `content.xml` пака. Маршрут повторяет этот приём
 *    своим архивом (`MAJESTIC_OVERLAY_INNER`). Это ГИПОТЕЗА по файлу владельца:
 *    в игре и на Majestic не проверено, доказательством считать нельзя.
 *    Пропы серверных паков (`…_p_mp_[mf]_clothes_pack0`) в маршрут не входят:
 *    в файле владельца их нет.
 *
 * Список — снимок сборки клиента: поменяется — обновить по журналу. Тот же
 * список и константы маршрута повторяет движок
 * (`install-engine/clothing-replace-manifest-trust.js`, `install-engine/astral-paths.js`),
 * тест сверяет их. Чистый JS, без импортов.
 */

export const MAJESTIC_DLC_WHITELIST = Object.freeze([
  "mp2023_01",
  "mp2023_02",
  "mp2024_01",
  "mpairraces",
  "mpapartment",
  "mpassault",
  "mpbattle",
  "mpbeach",
  "mpbiker",
  "mpbusiness",
  "mpbusiness2",
  "mpchristmas",
  "mpchristmas2",
  "mpchristmas2017",
  "mpchristmas2018",
  "mpchristmas3",
  "mpexecutive",
  "mpgunrunning",
  "mphalloween",
  "mpheist",
  "mpheist3",
  "mpheist4",
  "mphipster",
  "mpimportexport",
  "mpindependence",
  "mpjanuary2016",
  "mplowrider",
  "mplowrider2",
  "mplts",
  "mpluxe",
  "mpluxe2",
  "mppatchesng",
  "mppilot",
  "mpreplay",
  "mpsecurity",
  "mpsmuggler",
  "mpspecialraces",
  "mpstunt",
  "mpsum",
  "mpsum2",
  "mptuner",
  "mpvalentines",
  "mpvalentines2",
  "mpvinewood",
  "mpxmas_604490",
  "patch2023_01",
  "patch2023_02",
  "patch2024_01",
  "patchday10ng",
  "patchday11ng",
  "patchday12ng",
  "patchday13ng",
  "patchday14ng",
  "patchday15ng",
  "patchday16ng",
  "patchday17ng",
  "patchday18ng",
  "patchday19ng",
  "patchday1ng",
  "patchday20ng",
  "patchday21ng",
  "patchday22ng",
  "patchday23ng",
  "patchday24ng",
  "patchday25ng",
  "patchday26ng",
  "patchday27ng",
  "patchday28ng",
  "patchday2bng",
  "patchday2ng",
  "patchday3ng",
  "patchday4ng",
  "patchday5ng",
  "patchday6ng",
  "patchday7ng",
  "patchday8ng",
  "patchday9ng",
  "spupgrade",
]);

const SET = new Set(MAJESTIC_DLC_WHITELIST);

/** Пак игры в белом списке Majestic (имя папки пака, регистр не важен). */
export const majesticLoadsPack = (pack) =>
  SET.has(String(pack || "").toLowerCase());

/* Маршрут вещей серверных паков: белый пак и свой overlay-RPF в нём (гипотеза, см. шапку). */
export const MAJESTIC_OVERLAY_PACK = "patchday16ng";
export const MAJESTIC_OVERLAY_INNER = "x64/levels/gta5/astral_pack.rpf";

const OVERLAY_FOLDER = /^mp_([mf])_freemode_01_mp_\1_clothes_pack[0-3]$/;

/** Папка вещи серверного пака Majestic, которой открыт маршрут overlay-RPF. */
export const majesticOverlayFolder = (folder) =>
  OVERLAY_FOLDER.test(String(folder || "").toLowerCase());
