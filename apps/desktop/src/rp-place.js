import fs from "node:fs";
import path from "node:path";

import { RP_BOTH_CLIENTS_DEFAULT, RP_MODE_CHANNELS, RP_PLACES, applyRpModeDefault, findMajestic, findRageMp, resetRpModeAuto, rpModeKindsOn, rpModeSettled } from "./rp-mode-channel.js";

/*
 * «Где играю» (23.11.2026, слово владельца «да, так»): один выбор в настройках → GTA V — GTA 5 RP, Majestic или только сюжет (`RP_PLACES`). Он решает, включать ли режим RP (`rp-mode-channel.js`):
 * `rp` — включить, `majestic` и `story` — нет, пока не выбрано — по найденным клиентам (при двух клиентах режим включается сам, `RP_BOTH_CLIENTS_DEFAULT`).
 *
 * Выбор лежит в своём файле `rp-place.json` рядом с остальными настройками (`userData`), а не в `app-preferences.json`: тот держит копию в памяти (`PreferencesFile`, `app-presence.js`) и затёр бы чужую запись.
 * Читается при старте до режима (`channels/index.js`), синхронно и без импортов, кроме `node:fs` и модуля режима: оба уже в стартовом графе (`tests/main-startup-imports.test.js`).
 *
 * Смена выбора действует сразу, если нет установки и работы мастерской: окружение режима снимается (`resetRpModeAuto`) и ставится заново (`applyRpModeDefault`) — места установки читают его в момент «Применить».
 * Идёт установка — выбор только записывается, действует со следующего запуска (`applied: "restart"`). Уже поставленное режим не переносит и не убирает: ни при включении, ни при выключении.
 */

export const RP_PLACE_FILE = "rp-place.json";
const CLIENTS_KEEP_MS = 60_000;

/**
 * Что делает Astral без выбора человека (`applyRpModeDefaultNow`, `rp-mode-channel.js`): только RAGE MP — «GTA 5 RP»; только Majestic — «Majestic»; оба — по `RP_BOTH_CLIENTS_DEFAULT`
 * (`on` — режим включается сам, «GTA 5 RP»; `wait` — не включается, «Только сюжет»); ни одного — «Только сюжет».
 */
export function autoPlaceOf({ rage = false, majestic = false } = {}, bothClients = RP_BOTH_CLIENTS_DEFAULT) {
  if (rage && majestic) return bothClients === "on" ? "rp" : "story";
  if (rage) return "rp";
  return majestic ? "majestic" : "story";
}

const fileOf = (userData) => path.join(String(userData), RP_PLACE_FILE);

/** Сохранённый выбор: `rp`, `majestic`, `story`; нет файла, битый файл, чужое слово — `""` (не выбирал). */
export function readRpPlace(userData, read = fs.readFileSync) {
  try {
    const place = JSON.parse(read(fileOf(userData), "utf8"))?.place;
    return RP_PLACES.includes(place) ? place : "";
  } catch {
    return "";
  }
}

/** Запись файла с досылкой на диск: после переименования на диске лежит целый файл, а не пустое имя (сбой питания между записью и сбросом кэша). */
function writeSynced(file, text) {
  const handle = fs.openSync(file, "w");
  try {
    fs.writeSync(handle, text);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Записать выбор. Чужое слово — ошибка (в файл ничего не попадает). Запись не прямо в `rp-place.json`, а во временный файл рядом и переименованием поверх: оборванная запись (сбой, питание, закрытие
 * окна на записи) оставляет прежний целый файл, а не пустой. Иначе пустой файл читался бы как «не выбирал», и у человека с двумя клиентами, выбравшего «Majestic», режим включился бы сам.
 * Остаток `.tmp` после обрыва при чтении не берётся (выбор, чей ответ окно не получило, не подтверждён человеку) и затирается следующей записью.
 */
export function writeRpPlace(userData, place, write = writeSynced, rename = fs.renameSync) {
  if (!RP_PLACES.includes(place)) throw new TypeError(`Unknown place: ${place}`);
  const file = fileOf(userData);
  const temp = `${file}.tmp`;
  try {
    write(temp, JSON.stringify({ place }, null, 2));
    rename(temp, file);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      /* временного файла нет или он занят — прежний выбор не тронут */
    }
    throw error;
  }
}

/**
 * Выбор «Где играю» одного приложения. `userData` — функция (папка настроек читается в момент вызова), `busy()` — идёт ли установка или работа мастерской,
 * `note(строка, уровень)` — журнал. `apply` и `settled` — подмена для тестов (`applyRpModeDefault`, `rpModeSettled`).
 */
export function createRpPlace({
  userData,
  channel,
  env = process.env,
  busy = () => false,
  note = () => {},
  apply = applyRpModeDefault,
  settled = rpModeSettled,
  read = fs.readFileSync,
  write = writeSynced,
  rename = fs.renameSync,
  detect = findRageMp,
  detectMajestic = findMajestic,
  now = Date.now,
  bothClients = RP_BOTH_CLIENTS_DEFAULT,
} = {}) {
  const dir = () => {
    try {
      return typeof userData === "function" ? userData() : userData;
    } catch {
      return "";
    }
  };
  const available = RP_MODE_CHANNELS.includes(channel);
  let queue = Promise.resolve();

  const chosen = () => {
    const where = dir();
    return where ? readRpPlace(where, read) : "";
  };

  /* Какие клиенты найдены: поиск медленный (реестр, папка Majestic), а ответ редко меняется — держится минуту, как `rage-mp-status.js`. Окно получает только «найден или нет», путей нет. */
  let kept = null;
  async function clients() {
    if (kept && now() - kept.at < CLIENTS_KEEP_MS) return kept.found;
    let rage = false;
    let majestic = false;
    try {
      rage = Boolean(await detect());
    } catch {
      /* реестра нет или нет доступа — RAGE MP считаем не найденным */
    }
    try {
      majestic = Boolean(await detectMajestic());
    } catch {
      /* поиск Majestic упал — не найден */
    }
    kept = { at: now(), found: { rage, majestic } };
    return kept.found;
  }

  /**
   * `{ place, active, available }`: выбор человека (`""` — не выбирал), включён ли режим прямо сейчас (хоть один вид идёт контейнером), есть ли он в этом канале.
   * Пока человек не выбрал (и режим есть в канале) — ещё `found` (`{ rage, majestic }`, найден или нет) и `auto`: что делает Astral без выбора (`autoPlaceOf`), чтобы окно подсветило то, что нашло
   * автоопределение, а не «Только сюжет» у человека с одним клиентом Majestic.
   */
  async function state() {
    await settled();
    const place = chosen();
    const answer = { place, active: Object.values(rpModeKindsOn(env)).some(Boolean), available };
    if (place === "" && available) {
      const found = await clients();
      return { ...answer, found, auto: autoPlaceOf(found, bothClients) };
    }
    return answer;
  }

  async function change(input) {
    const place = input?.place;
    if (!RP_PLACES.includes(place)) throw new TypeError(`Unknown place: ${place}`);
    const where = dir();
    if (!where) throw new Error("Папка настроек недоступна.");
    writeRpPlace(where, place, write, rename);
    await settled();
    let applied = "none";
    if (available) {
      if (busy()) applied = "restart";
      else {
        resetRpModeAuto(env);
        await apply({ channel, env, note, place });
        applied = "now";
      }
    }
    return { ...(await state()), applied };
  }

  /** Записать выбор и, если можно, применить сразу; ответ — состояние и `applied`: `now`, `restart` (идёт работа) или `none` (режима нет в этом канале). Смены идут по очереди. */
  const set = (input) => {
    const run = queue.then(() => change(input));
    queue = run.catch(() => {});
    return run;
  };

  return {
    chosen,
    state,
    set,
    registerIpc({ IPC, handleIpc, trusted }) {
      handleIpc(IPC.RP_PLACE_STATE, (event) => trusted(event, () => state()));
      handleIpc(IPC.RP_PLACE_SET, (event, input) => trusted(event, () => set(input)));
    },
  };
}

/** Для главного процесса: папка настроек — `userData` приложения. */
export function rpPlaceForApp({ app, channel, env = process.env, busy, note } = {}) {
  return createRpPlace({ userData: () => app.getPath("userData"), channel, env, busy, note });
}
