/*
 * Режим «RP» (20.11.2026, `docs/RP-MODE-ALPHA.md`; в альфе, бете и релизе с 22.11.2026, слово владельца: «в релиз всем»): оружие, одежда, дороги, растительность, места и наложения тела (тату, бороды) ставятся через контейнер `x64/astral/*.rpf` в `update.rpf`.
 * Включается само: канал alpha, beta или release, найден RAGE MP (Majestic рядом или нет — решает `RP_BOTH_CLIENTS_DEFAULT`: слово владельца 23.11.2026 «да, так» — при двух клиентах и без выбора человека режим включается сам),
 * `ASTRAL_RP_MODE=on` включает при любом наборе (в тех же каналах; запуск вне канала, dev-сборка — выключено), `off`/`0`/`false`/`no` — не ставить ничего.
 * Выбор человека «Где играю» (`rp-place.js`, настройки → GTA V): `rp` включает без поиска клиентов, `majestic` и `story` не включают; без выбора — по найденным клиентам.
 * Выключатель вида в окружении (в том числе `0`) сильнее умолчания. Что поставил режим сам — в `ASTRAL_RP_MODE_AUTO`:
 * дороги и растительность на стоящих пакетах тогда идут прежним путём со строкой в журнале (`viaContainerOrOld`), явное значение отказывает, как раньше.
 * Имена и слова записаны здесь без импорта пакета установки (его при старте грузить нельзя, `tests/main-startup-imports.test.js`); равенство держит `tests/rp-mode-channel.test.js`.
 */

export const RP_MODE_ENV = "ASTRAL_RP_MODE";
/** Выключатели, которые поставил сам режим (список через запятую): отличие автоматического включения от явного значения вида. */
export const RP_MODE_AUTO_ENV = "ASTRAL_RP_MODE_AUTO";

/** Выключатель носителей и слово дорог через носитель (равенство с пакетом установки держит тест). */
export const CARRIERS_ENV = "ASTRAL_CARRIERS";
export const ROADS_CARRIER_WORD = "carrier";
/** Виды, что идут через носитель: дороги (вся разметка) и растительность (трава, живые изгороди; деревья — в `update.rpf`). */
const CARRIER_KINDS = Object.freeze(["roads", "vegetation"]);

/**
 * Слова полос-подпакетов таблицы носителей (девять по 1,5 ГиБ, `SUBPACK_LANE_BYTES`; слабый ПК, Р11) (`CARRIER_LANES`, строки `registration: "pack-sub"`, порядок таблицы): записаны здесь без импорта пакета установки (модуль грузится при старте и импортов не имеет);
 * равенство с таблицей держит `tests/rp-mode-subpack-lanes.test.js`. Их же ставит проверочный выключатель альфы (`pack-carriers-switch.js`).
 */
export const SUBPACK_LANE_WORDS = Object.freeze(["mpvalentines2_s1", "mpxmas_604490_s1", "mpspecialraces_s1", "mpairraces_s1", "mphalloween_s1", "mpluxe2_s1", "mpjanuary2016_s1", "mpluxe_s1", "mpbiker_s1"]);

/** Значение `ASTRAL_CARRIERS` «дороги и растительность целиком»: `update2` и все полосы таблицы. */
export const SUBPACK_CARRIERS_VALUE = ["update2", ...SUBPACK_LANE_WORDS].join(",");

/**
 * Сборочный флаг (21.11.2026, ступень 2): режим RP ставит в `ASTRAL_CARRIERS` не одно `update2`, а `update2` и полосы-подпакеты штатных паков, и дороги с растительностью
 * ложатся на GTA 5 RP целиком. ВКЛ с 22.11.2026: набор «дороги целиком + трава обеих зон» (пять подпакетов) снят в сюжете, и сервер GTA 5 RP впустил владельца с ним (заходы 10:21 и 10:25;
 * шесть разделяющих наборов — тоже). Заход 03:28 с тем же набором один раз завис на входе, причина не найдена (`docs/TEAM-ZONES.md`, строки лида 1 за 22.11).
 * `false` возвращает ступень 1 (одно `update2`). Значение человека или стенда в `ASTRAL_CARRIERS` сильнее и не перезаписывается.
 */
export const RP_MODE_SUBPACK_LANES = true;

/** Выбор человека «Где играю» (настройки → GTA V): GTA 5 RP, Majestic, только сюжет. Пустая строка — не выбирал. Запись выбора — `rp-place.js`. */
export const RP_PLACES = Object.freeze(["rp", "majestic", "story"]);

/**
 * Что делать при двух клиентах (RAGE MP и Majestic), пока человек не выбрал: `"on"` — режим включается сам (решение владельца 23.11.2026, «да, так»),
 * `"wait"` — режим не включается и ждёт выбора (поведение 20–23.11.2026, строка `warn` в журнале). Одна константа: вариант А ↔ Б меняется здесь.
 */
export const RP_BOTH_CLIENTS_DEFAULT = "on";

/** Каналы, где режим «RP» включается сам (имена каналов — `channels/branches.js`, `BRANCHES`): альфа, бета и релиз. Запуск вне канала (dev-сборка, `ownChannel` пуст) в список не входит: режим выключен. */
export const RP_MODE_CHANNELS = Object.freeze(["alpha", "beta", "release"]);

/**
 * Виды, которые режим переводит на контейнер. Шесть видов, у каждого своя строка выключателя; тест держит равенство имён с пакетом установки.
 * Наложения тела (тату, бороды, `ASTRAL_OVERLAYS_VIA_UPDATE`, 21.11.2026) — свой вид со своим контейнером `astral_rp_overlays.rpf` (`docs/RP-OVERLAYS-CONTAINER.md`): без него на GTA 5 RP
 * тату по умолчанию уходило пакетом `astral_clothing`, который клиент RAGE MP не подключает.
 */
export const RP_MODE_KINDS = Object.freeze([
  Object.freeze({ kind: "weapons", env: "ASTRAL_WEAPONS_VIA_UPDATE", word: "container" }),
  Object.freeze({ kind: "clothing", env: "ASTRAL_CLOTHING_VIA_UPDATE", word: "container" }),
  Object.freeze({ kind: "roads", env: "ASTRAL_ROADS_VIA_UPDATE", word: ROADS_CARRIER_WORD }),
  Object.freeze({ kind: "vegetation", env: "ASTRAL_VEGETATION_VIA_UPDATE", word: ROADS_CARRIER_WORD }),
  Object.freeze({ kind: "places", env: "ASTRAL_PLACES_VIA_UPDATE", word: "container" }),
  Object.freeze({ kind: "overlays", env: "ASTRAL_OVERLAYS_VIA_UPDATE", word: "container" }),
]);

const OFF_WORDS = new Set(["off", "0", "false", "no"]);

/**
 * Какие виды сейчас идут контейнером — по окружению, теми же словами, что у маршрутов (`container`, `1`, `true`; у дорог ещё `carrier`): `{ weapons, clothing, roads, vegetation, places, overlays }`.
 * Окно (`rage-mp-status.js` → `getRageMpStatus`) по этому не показывает до «Применить» строку «На GTA 5 RP пока не видна»: работа ляжет контейнером. Имена не импортируются из пакета
 * установки (при старте его грузить нельзя); равенство слов держит `tests/rp-mode-channel.test.js`.
 */
export function rpModeKindsOn(env = process.env) {
  const words = (name, extra = []) => ["container", "1", "true", ...extra].includes(String(env?.[name] ?? "").trim().toLowerCase());
  return Object.fromEntries(RP_MODE_KINDS.map(({ kind, env: name }) => [kind, words(name, CARRIER_KINDS.includes(kind) ? ["carrier"] : [])]));
}

/** Клиент RAGE MP по умолчанию — по реестру (`rage-mp-status.js`); модуль грузится по вызову, при старте его не тянем. */
export async function findRageMp() {
  const { rageGamePath } = await import("./launcher-game-paths.js");
  return rageGamePath();
}

/** Лаунчер Majestic по умолчанию — по его папке (`majesticGamePath`); по вызову, не при старте. */
export async function findMajestic() {
  const { majesticGamePath } = await import("./launcher-game-paths.js");
  return (await majesticGamePath()).installed === true;
}

const BOTH_LINE = "найдены RAGE MP и Majestic: режим RP не включён, включить вручную — ASTRAL_RP_MODE=on";
/** Два клиента, выбора нет, `RP_BOTH_CLIENTS_DEFAULT = "on"`: режим включён сам, человек может выбрать другое (уровень `info`, не поломка). */
const BOTH_AUTO_LINE = "найдены RAGE MP и Majestic: режим RP включён сам; другое — Настройки → GTA V → Где играю";
const PLACE_OFF_LINE = (place) => `в настройках выбрано «${place === "majestic" ? "Majestic" : "Только сюжет"}»: режим RP не включён`;

/** Поставил ли выключатель `name` сам режим (а не человек): места установки читают это в момент установки. */
export function isRpModeAuto(name, env = process.env) {
  return String(env?.[RP_MODE_AUTO_ENV] ?? "")
    .split(",")
    .map((item) => item.trim())
    .includes(name);
}

/**
 * Ставит умолчания видов в окружение. Ответ: `{ state: "on" | "off", set: [имена] }`; `off` — окружение не менялось.
 * `detect` — поиск RAGE MP, `detectMajestic` — поиск Majestic, `note(строка, уровень)` — журнал (уровень `info`; без него — `warn`).
 * `subpackLanes` — сборочный флаг `RP_MODE_SUBPACK_LANES` (тесты подают свой). `place` — выбор человека `RP_PLACES` (`""` — не выбирал), `bothClients` — умолчание при двух клиентах (`RP_BOTH_CLIENTS_DEFAULT`).
 * @param {{ channel?: string|null, env?: object, detect?: () => Promise<unknown>, detectMajestic?: () => Promise<unknown>, note?: (line: string, level?: string) => void, subpackLanes?: boolean, place?: string, bothClients?: "on"|"wait" }} [options]
 */
export function applyRpModeDefault(options = {}) {
  const run = applyRpModeDefaultNow(options);
  /* Сторож носителя при старте ждёт именно эту работу (`rpModeSettled`): без неё он прочёл бы окружение до того, как режим поставил `ASTRAL_CARRIERS`. */
  lastApply = run.catch(() => {});
  return run;
}

let lastApply = Promise.resolve();
/** Дожидается последнего вызова `applyRpModeDefault` (сбой не бросает); вызова не было — готово сразу. */
export const rpModeSettled = () => lastApply;

/**
 * Снимает то, что поставил САМ режим (имена из `ASTRAL_RP_MODE_AUTO`, в том числе `ASTRAL_CARRIERS`, если его поставил режим), и стирает метку. Значения, заданные человеком (их нет в метке), не трогаются.
 * Нужна при смене выбора «Где играю» на лету (`rp-place.js`): `applyRpModeDefault` только ставит, обратного хода у него нет. Ответ — снятые имена.
 */
export function resetRpModeAuto(env = process.env) {
  const names = String(env?.[RP_MODE_AUTO_ENV] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const name of names) delete env[name];
  delete env[RP_MODE_AUTO_ENV];
  return names;
}

async function applyRpModeDefaultNow({ channel, env = process.env, detect = findRageMp, detectMajestic = findMajestic, note = () => {}, subpackLanes = RP_MODE_SUBPACK_LANES, place = "", bothClients = RP_BOTH_CLIENTS_DEFAULT } = {}) {
  const none = { state: "off", set: [] };
  if (!RP_MODE_CHANNELS.includes(channel)) return none;
  const word = String(env[RP_MODE_ENV] ?? "").trim().toLowerCase();
  if (OFF_WORDS.has(word)) return none;
  const chosen = RP_PLACES.includes(place) ? place : "";
  /* Выбор человека сильнее поиска клиентов (реестр не читается): «Majestic» и «Только сюжет» — не включать, «GTA 5 RP» — включить, как `ASTRAL_RP_MODE=on`. `off` в окружении (выше) главнее и выбора. */
  if (word !== "on" && (chosen === "majestic" || chosen === "story")) {
    note(PLACE_OFF_LINE(chosen), "info");
    return none;
  }
  if (word !== "on" && chosen !== "rp") {
    let rage = false;
    try {
      rage = Boolean(await detect());
    } catch {
      /* реестра нет или нет доступа — RAGE MP считаем не найденным */
    }
    if (!rage) return none;
    let majestic = false;
    try {
      majestic = Boolean(await detectMajestic());
    } catch (error) {
      /* поиск Majestic упал — считаем «не найден» и ведём себя как при одном RAGE MP, но пишем в журнал */
      note(`поиск Majestic не удался (${error?.message || error}): считаем, что Majestic не найден`);
    }
    if (majestic) {
      /* Два клиента, выбора нет: по слову владельца 23.11.2026 режим включается сам; `"wait"` возвращает прежнее «не включать, пока не скажут». */
      if (bothClients !== "on") {
        note(BOTH_LINE);
        return none;
      }
      note(BOTH_AUTO_LINE, "info");
    }
  }
  const set = [];
  for (const { kind, env: name, word } of RP_MODE_KINDS) {
    if (String(env[name] ?? "").trim() !== "") continue;
    let value = word;
    if (CARRIER_KINDS.includes(kind)) {
      /* Дороги и растительность (трава, живые изгороди) идут через носитель `update2.rpf` (`carrier` + `ASTRAL_CARRIERS=update2`). Человек уже поставил `ASTRAL_CARRIERS`: без слова `update2` его не трогаем, а виду ставим `container`. */
      const carriers = String(env[CARRIERS_ENV] ?? "").trim();
      if (carriers === "") {
        env[CARRIERS_ENV] = subpackLanes ? SUBPACK_CARRIERS_VALUE : "update2";
        set.push(CARRIERS_ENV);
        value = RP_MODE_KINDS.find((item) => item.kind === kind).word;
      } else if (!carriers.split(",").some((item) => item.trim().toLowerCase() === "update2")) value = "container";
    }
    env[name] = value;
    set.push(name);
  }
  if (set.length) env[RP_MODE_AUTO_ENV] = [...new Set([...String(env[RP_MODE_AUTO_ENV] ?? "").split(",").map((item) => item.trim()).filter(Boolean), ...set])].join(",");
  return { state: "on", set };
}

/**
 * Сборка через контейнер, а при автоматическом включении режима — с откатом на прежний путь: отказ режима (`isRefusal`) не доходит до человека, строка уходит в журнал.
 * Явное значение вида (`auto: false`) отказывает, как раньше. `container()` и `old()` — две сборки; `note(строка)` — журнал.
 */
export async function viaContainerOrOld({ auto = false, container, old, isRefusal, note = () => {}, label = "" }) {
  if (!auto) return { built: await container(), fellBack: false };
  try {
    return { built: await container(), fellBack: false };
  } catch (error) {
    if (!isRefusal(error)) throw error;
    note(`${label}: режим RP включён сам, ${error.message} Ставим прежним путём.`);
    return { built: await old(), fellBack: true, refusal: error };
  }
}
