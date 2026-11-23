/*
 * Проверочный выключатель «Дороги и трава вместе на GTA 5 RP» (21.11.2026, панель «Новый движок (проверка)», только альфа).
 *
 * Раскладка «дороги и растительность вместе через штатный пакет игры» включается переменной `ASTRAL_CARRIERS=update2,mpbiker` (`carrier-targets.js`). Альфа с версии 48 поднимает себя от
 * администратора (`elevation.js`): `Start-Process -Verb RunAs` получает только аргументы и рабочую папку, окружение не передаётся — переменная, выставленная в обычной консоли, до работающего
 * процесса не доходит. Поэтому выбор лежит в `rust-switches.json` (рядом с группами панели, ключ `carriers-all`) и при старте главного процесса превращается в ту же переменную.
 *
 * Правила: по умолчанию ВЫКЛ; ставится только в канале `alpha` и только если `ASTRAL_CARRIERS` пуста (любое значение человека сильнее выключателя); окно показывает сохранённый выбор, а без
 * выбора — что стоит в окружении. На лету окружение не меняется: носители читаются при старте (`carriers-start-guard.js`), включение действует после перезапуска. Модуль без импортов: главный процесс
 * грузит его на старте (`tests/main-startup-imports.test.js`); равенство имени переменной с `carrier-targets.js` держит `tests/pack-carriers-switch.test.js`.
 */

import { SUBPACK_CARRIERS_VALUE } from "./rp-mode-channel.js";

/** Ключ выбора в `rust-switches.json` (`groups`) и имя строки в окне. Это не группа движка: `all` её не включает. */
export const PACK_CARRIERS_ID = "carriers-all";
/** Переменная носителей (то же имя, что `CARRIERS_ENV` в пакете установки). */
export const PACK_CARRIERS_ENV = "ASTRAL_CARRIERS";
/** Слова носителей (ступень 2, 21.11.2026): `update2` и полосы-подпакеты штатных паков (все строки `CARRIER_LANES` с `registration: "pack-sub"`) — дороги и растительность целиком; то же значение ставит сборочный флаг режима RP (`RP_MODE_SUBPACK_LANES`). */
export const PACK_CARRIERS_VALUE = SUBPACK_CARRIERS_VALUE;
/** Канал, где выключатель есть. */
export const PACK_CARRIERS_CHANNEL = "alpha";

const words = (env) =>
  String(env?.[PACK_CARRIERS_ENV] ?? "")
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);

/** Включены ли `update2` и ВСЕ полосы таблицы в окружении прямо сейчас (слова любого регистра, порядок и лишнее не мешают). */
const allInEnv = (env) => {
  const listed = words(env);
  return PACK_CARRIERS_VALUE.split(",").every((word) => listed.includes(word));
};

/**
 * Применить сохранённый выбор при старте: `true` — слово поставлено. Не альфа, выбор не «вкл.» (строго `true`), переменная уже задана человеком — окружение не тронуто.
 * @param {{ channel?: string|null, env?: object, chosen?: unknown }} [options]
 */
export function applyPackCarriers({ channel, env = process.env, chosen } = {}) {
  if (channel !== PACK_CARRIERS_CHANNEL) return false;
  if (chosen !== true) return false;
  if (String(env[PACK_CARRIERS_ENV] ?? "").trim() !== "") return false;
  env[PACK_CARRIERS_ENV] = PACK_CARRIERS_VALUE;
  return true;
}

/** Слово для строки окна: `on` или `off`. Выбор человека, а без выбора — оба носителя в окружении сейчас (переменная, заданная вручную). */
export function packCarriersState({ chosen, env = process.env } = {}) {
  const on = typeof chosen === "boolean" ? chosen : allInEnv(env);
  return on ? "on" : "off";
}
