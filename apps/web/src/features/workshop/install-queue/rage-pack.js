/*
 * Работа мастерской своим пакетом Astral и клиент RAGE MP (GTA 5 RP): строка в журнале приложения (18.11.2026).
 *
 * ФАКТ (журнал тестера beta.108, замер 19.11.2026): клиент RAGE MP не подключает пакеты дополнений Astral `update/x64/dlcpacks/astral_*`. В сюжетной игре работа видна, на GTA 5 RP нет.
 * Релиз 1.0.2 (слово владельца: «все эти плашки поубирать»): человеку окно про это не говорит ни до «Применить», ни в уведомлении об установке. Остаётся только след для поддержки:
 * когда на ПК найден RAGE MP, работа встала своим пакетом и не шла контейнером, в журнал приложения пишется одна строка `[install]` уровня warn (`ragePackProblem` → `writeRagePackLog`, `apply.js`).
 * Нет RAGE MP — нет записи. Про Majestic запись молчит: проверки на нём нет.
 *
 * ИСКЛЮЧЕНИЕ: оружие в режиме RP идёт контейнером в update.rpf, записи нет (`MODE_IS_THE_EVIDENCE`): у оружия ответ установки не несёт признака «легло контейнером», о нём говорит включённый режим.
 * Замена звука в `RESIDENT.rpf` пакета не касается (записи нет). Пакеты карточек каталога сюда не входят.
 *
 * КАКИЕ РАБОТЫ СТАВЯТСЯ СВОИМ ПАКЕТОМ (по коду движка, `packages/install-engine`):
 *   • места — `PLACES_DLC_SETS` (`places-dlc.js`): zones, factory, hangar, mapping, arenas, megamall, youtool, vinewood, busstops,
 *     mslzones, floatlogo, airships, shops, billboards, captzones, schedule, flags, atms — пакет `astral_places`;
 *   • растительность — `astral_vegetation` и `astral_vegetation_b`; дороги — `astral_roads` и `astral_roads_b`;
 *   • Мегамолл Дэвиса (`mega-mall-install-adapter.js`) — `astral_davis_megamall`;
 *   • звук ствола (студия звука) — `astral_audio`;
 *   • оружие: скины студии, паки стволов — `astral_weapons`;
 *   • ухудшение текстур и «Стиль мира» — `astral_textures`, `_b`, `_c` (ключ `astral.optimization.textures.v1`).
 * Замена одежды (`astral_clothing`) сюда не входит: у неё свои слова по коду установки (`clothing-install-visibility.js`, `features/clothing/install-words.js`).
 */

import { desktopHost } from "../../../api.js";

const PLACES_SETS = [
  "zones",
  "factory",
  "hangar",
  "mapping",
  "arenas",
  "megamall",
  "youtool",
  "vinewood",
  "busstops",
  "mslzones",
  "floatlogo",
  "airships",
  "shops",
  "billboards",
  "captzones",
  "schedule",
  "flags",
  "atms",
];

/* Ключ работы в очереди (точный) → пакеты Astral, в которые она ставится. */
const EXACT = new Map([
  ...PLACES_SETS.map((set) => [`astral.${set}.install.v1`, ["astral_places"]]),
  [
    "astral.vegetation.install.v1",
    ["astral_vegetation", "astral_vegetation_b"],
  ],
  [
    "astral.vegetation-studio.install.v1",
    ["astral_vegetation", "astral_vegetation_b"],
  ],
  ["astral.roads.install.v1", ["astral_roads", "astral_roads_b"]],
  ["astral.mega-mall.install.v1", ["astral_davis_megamall"]],
  ["astral.gun-studio.pack-install.v1", ["astral_weapons"]],
  /* «Стиль мира» и ухудшение текстур: один пакет движка на ступень, ЧБ-мир и стиль идут во втором и третьем (`install-queue/tasks/textures.js`). */
  [
    "astral.optimization.textures.v1",
    ["astral_textures", "astral_textures_b", "astral_textures_c"],
  ],
]);

/* Ключи с хвостом (имя ствола, раздел): начало → пакеты. */
const PREFIXED = [
  ["astral.sound-studio.install", ["astral_audio"]],
  ["astral.gun-studio.install:", ["astral_weapons"]],
  ["astral.gunpack.install:", ["astral_weapons"]],
];

const NONE = Object.freeze([]);

/* Звук, который студия заменяет прямо в `RESIDENT.rpf` (попадания, окружение, сирены — не стволы), пакета `astral_audio` не касается: что видит RAGE MP в этом файле, неизвестно — записи нет. Звук ствола (личный голос, `WEAPONS_PLAYER.rpf` и банки дополнений) идёт пакетом. Ключ: `astral.sound-studio.install:<архив>:<банк>`. */
const DIRECT_SOUND_ARCHIVE =
  /^astral\.sound-studio\.install:x64\/audio\/sfx\/RESIDENT\.rpf:/i;

/** Пакеты `astral_*`, в которые ставится работа с этим ключом очереди; пусто — своим пакетом не ставится. */
export function ownPacksOf(key) {
  const text = String(key ?? "");
  const exact = EXACT.get(text);
  if (exact) return exact;
  if (DIRECT_SOUND_ARCHIVE.test(text)) return NONE;
  for (const [prefix, packs] of PREFIXED)
    if (text.startsWith(prefix)) return packs;
  return NONE;
}

/* ---------- найден ли RAGE MP ---------- */

const state = {
  found: false,
  loaded: false,
  at: 0,
  pending: null,
  rpMode: null,
};
const KEEP_MS = 60_000;

function put(found, rpMode = null) {
  state.rpMode = rpMode && typeof rpMode === "object" ? rpMode : null;
  state.found = found;
  state.loaded = true;
  state.at = Date.now();
}

/** Спросить приложение, найден ли клиент RAGE MP (раз в минуту, не чаще). Нет моста — «не найден». */
export function refreshRageMp({ force = false } = {}) {
  if (state.pending) return state.pending;
  if (!force && state.loaded && Date.now() - state.at < KEEP_MS)
    return Promise.resolve(state.found);
  const host = desktopHost();
  if (typeof host?.getRageMpStatus !== "function") {
    put(false);
    return Promise.resolve(false);
  }
  state.pending = Promise.resolve()
    .then(() => host.getRageMpStatus())
    .then(
      (reply) => put(reply?.found === true, reply?.rpMode),
      () => put(false),
    )
    .then(() => {
      state.pending = null;
      return state.found;
    });
  return state.pending;
}

export function resetRageMpForTests() {
  state.rpMode = null;
  state.found = false;
  state.loaded = false;
  state.at = 0;
  state.pending = null;
}

/* ---------- код проблемы и строка журнала ---------- */

/* У оружия ответ установки не несёт признака «легло контейнером» (`viaContainer` ставит только задача мест, дорог и растительности): о нём говорит включённый режим RP. */
const MODE_IS_THE_EVIDENCE = (pack) => pack === "astral_weapons";

/**
 * Проблема в виде кода: `own-pack-rage` — работа встанет в пакет Astral, а на ПК найден RAGE MP. `null` — писать нечего
 * (работа не своим пакетом, RAGE MP нет или оружие в режиме RP идёт контейнером, `rpMode.weapons`).
 */
export function ragePackProblem(
  key,
  found = state.found,
  mode = state.rpMode,
) {
  const packs = ownPacksOf(key);
  if (!found || !packs.length) return null;
  if (packs.every(MODE_IS_THE_EVIDENCE) && mode?.weapons === true) return null;
  return { level: "warn", code: "own-pack-rage", packs: [...packs] };
}

/** Строка журнала приложения (по-русски, `[install]`, warn): работа, пакет и что на сервере её не видно. */
export function ragePackLogLine(title, packs) {
  const list = [...packs];
  const noun = list.length > 1 ? "пакеты" : "пакет";
  return `${String(title || "Работа")}: ${noun} ${list.join(", ")} клиент RAGE MP (GTA 5 RP) не подключает — на сервере работа не видна`;
}

/** Записать строку в журнал приложения; сбой записи установку не трогает. */
export function writeRagePackLog(title, packs) {
  try {
    const host = desktopHost();
    void Promise.resolve(
      host?.writeAppLog?.({
        level: "warn",
        source: "install",
        message: ragePackLogLine(title, packs),
      }),
    ).catch(() => {});
  } catch {
    /* журнал недоступен — установка уже идёт */
  }
}
