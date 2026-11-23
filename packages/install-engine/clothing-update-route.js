/*
 * Одежда freemode через контейнер в `update.rpf` (GTA 5 RP, 20.11.2026, `docs/RP-CLOTHING-CONTAINER.md`): куда писать файл одежды, чтобы его увидела игра,
 * у которой не открыт пакет `astral_clothing` (клиент RAGE MP пакеты Astral не монтирует, запись в `update.rpf` видна).
 *
 * Проба сюжетки (X1c, X2, 20.11.2026, `docs/handoff/RP-ROUTE-HELP-2011.md`, 9.4): запись контейнера Astral `x64/astral/<имя>.rpf/<папка педа>/<файл>`
 * перекрывает штатную одежду (`mp_m_freemode_01_mp_m_january2016/task_diff_000_a_uni.ytd` — пурпурный жилет), а плоское имя без папки не перекрывает ничего.
 * Поэтому путь записи в контейнере — всегда `<папка педа>/<файл>`; папка педа та же, что уже стоит в записи пакета одежды
 * (`astral_stream_00.rpf/<папка педа>/<файл>`, форма `manifest.js`).
 *
 * Не проверено игрой: `.ydd` (модель одежды), реквизит (`…_01_p_…`, в том числе базовый `mp_[mf]_freemode_01_p`), любой сервер. Базовая папка без коллекции
 * (`mp_m_freemode_01/…`, `mp_f_freemode_01/…`) снята в сюжете для словарей `.ytd`; базовый реквизит остаётся в пакете одежды со строкой в журнале.
 *
 * Модуль чистый: ввода-вывода нет, окружение подаёт вызывающий.
 */

export const CLOTHING_VIA_UPDATE_ENV = "ASTRAL_CLOTHING_VIA_UPDATE";
export const CLOTHING_UPDATE_TARGET = "update/update.rpf";
/** Свой контейнер одежды: отдельный от оружия и дорог, чтобы одежда ставилась и снималась порознь. */
export const CLOTHING_CONTAINER = "x64/astral/astral_rp_clothing.rpf";

/** Пакет-хост одежды и потоковые архивы в нём, куда сегодня ложатся записи (`manifest.js`, `clothing-dlc.js`). */
export const CLOTHING_HOST_TARGET = "update/x64/dlcpacks/astral_clothing/dlc.rpf";
const HOST_ARCHIVE = /^astral_stream_(?:00|01)\.rpf\//;

/** Папка педа с коллекцией (dlc-суффикс): `mp_m_freemode_01_<коллекция>`, `mp_f_freemode_01_p_<коллекция>`. Тот же разбор, что у замка заменёнки. */
const FOLDER = /^mp_([mf])_freemode_01(_p)?(?:_([a-z0-9_]{1,64}))?$/;
/**
 * Папка сюжетного героя без коллекции (`player_zero`, `player_one`, `player_two`; `_p` — реквизит): штатные файлы героев лежат в `streamedpeds_players.rpf`
 * под именем героя, пакеты Rockstar дают им новые вещи той же папкой (`rp-clothing-story-peds.md`, 20.11.2026). ПОДТВЕРЖДЕНО ИГРОЙ: снято лидом 1 в сюжетке 20.11 — Франклин,
 * верх и штаны (434 словаря `uppr_diff_*` и `lowr_diff_*`) пурпурные с трёх сторон, без `player_one.ymt` (`docs/RP-CLOTHING-CONTAINER.md`). Пара «`.ymt` + папка» этим путём не
 * переносится (`.ymt` не `.ydd`/`.ytd`) и, по снятому, не нужна. `player_two_trevor_heist` (отдельный наряд со своим `.ymt`) сюда не входит.
 */
const HERO_FOLDER = /^player_(?:zero|one|two)(?:_p)?$/;
/** Файл одежды: модель или словарь, строчные, без папок и «..». */
const LEAF = /^[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ydd|ytd)$/;

/** Включён ли режим: `1`, `true` или `container` (любой регистр). Без окружения — выключен. */
export function clothingUpdateRouteEnabled(env = {}) {
  return ["1", "true", "container"].includes(String(env?.[CLOTHING_VIA_UPDATE_ENV] ?? "").trim().toLowerCase());
}

/**
 * Запись пакета одежды → запись контейнера. `entry` — как в манифесте (`astral_stream_00.rpf/<папка педа>/<файл>`).
 * Ответ: `{ ready: true, entry, folder, leaf, gender }` (у сюжетного героя ещё `story: true`) или `{ ready: false, reason }`; причины: `not-host-entry`,
 * `no-ped-folder` (плоское имя или лишняя вложенность), `bad-folder` (не папка freemode и не папка героя), `base-props` (реквизит базовой папки `mp_[mf]_freemode_01_p`
 * без коллекции — игрой не проверен), `bad-name`. Базовые папки одежды `mp_m_freemode_01` и `mp_f_freemode_01` маршрут берёт (снято в сюжете, `.ytd`).
 */
export function clothingContainerRoute(entry) {
  const text = String(entry ?? "").toLowerCase();
  if (!HOST_ARCHIVE.test(text)) return { ready: false, reason: "not-host-entry" };
  const parts = text.slice(text.indexOf("/") + 1).split("/");
  if (parts.length !== 2) return { ready: false, reason: "no-ped-folder" };
  const [folder, leaf] = parts;
  /* Сюжетный герой (все трое мужчины): путь тот же, `<папка героя>/<файл>`; подтверждено игрой на Франклине (см. `HERO_FOLDER`). */
  if (HERO_FOLDER.test(folder)) {
    if (!LEAF.test(leaf) || leaf.includes("..")) return { ready: false, reason: "bad-name" };
    return { ready: true, entry: `${CLOTHING_CONTAINER}/${folder}/${leaf}`, folder, leaf, gender: "male", story: true };
  }
  const match = FOLDER.exec(folder);
  if (!match) return { ready: false, reason: "bad-folder" };
  /* Базовая папка без коллекции: `mp_m_freemode_01` и `mp_f_freemode_01` — снято в сюжете (словари `.ytd`, 20.11); реквизит `…_01_p` без коллекции игрой не проверен. */
  if (!match[3] && match[2]) return { ready: false, reason: "base-props" };
  if (!LEAF.test(leaf) || leaf.includes("..")) return { ready: false, reason: "bad-name" };
  return { ready: true, entry: `${CLOTHING_CONTAINER}/${folder}/${leaf}`, folder, leaf, gender: match[1] === "f" ? "female" : "male" };
}

const isHost = (file) => file?.target?.toLowerCase() === CLOTHING_HOST_TARGET && HOST_ARCHIVE.test(String(file.entry || "").toLowerCase());

/** Записи пакета в хосте одежды, у которых папка — сюжетный герой: без маршрута через update.rpf они в `astral_clothing` не ложатся (хост — для freemode). */
export const clothingHeroHostEntries = (files = []) =>
  files.filter(isHost).filter((file) => HERO_FOLDER.test(String(file.entry || "").toLowerCase().split("/")[1] ?? "")).map((file) => String(file.entry));

/** Имена записей хоста одежды в пакете (для журнала и проверок). */
export const clothingHostEntries = (files = []) => files.filter(isHost).map((file) => String(file.entry));

/**
 * Перевод файлов пакета одежды в контейнер. Готовые (`import`) уходят в `update.rpf`, остальные остаются в хосте с причиной; ничего молча не пропадает.
 * Исходные файлы не меняются; чужие файлы пакета (не из хоста) идут как есть. Запись, не являющаяся `import`, и дубль пути в контейнере остаются в хосте.
 * Ответ: `{ files, moved, kept: [{ entry, reason }], all }`; `all` — все файлы хоста переведены.
 */
export function translateClothingFiles({ files = [] } = {}) {
  let moved = 0;
  const kept = [];
  const taken = new Set();
  const next = files.map((file) => {
    if (!isHost(file)) return file;
    if (file.action !== "import") {
      kept.push({ entry: String(file.entry), reason: "not-import" });
      return file;
    }
    const route = clothingContainerRoute(file.entry);
    if (!route.ready) {
      kept.push({ entry: String(file.entry), reason: route.reason });
      return file;
    }
    if (taken.has(route.entry)) {
      kept.push({ entry: String(file.entry), reason: "duplicate" });
      return file;
    }
    taken.add(route.entry);
    moved += 1;
    return { ...file, target: CLOTHING_UPDATE_TARGET, entry: route.entry, action: "import" };
  });
  return { files: next, moved, kept, all: moved > 0 && kept.length === 0 };
}
