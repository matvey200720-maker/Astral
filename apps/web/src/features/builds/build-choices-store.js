/*
 * Выборы цели одежды лежат в локальном хранилище по id сборки (16.11.2026, `build-choices.js`): так их держат и свои сборки этого ПК, и облачные — запись облачной сборки приходит с сервера и своих полей
 * не хранит, а выбор «на что поставить» у каждого человека свой. Как работы мастерской (`build-works-store.js`): отдельный ключ, а к записи сборки они подмешиваются при чтении списка
 * (`withStoredChoices`, его зовёт `withStoredWorks`, поэтому оболочка и «Сборки» получают их там же, где получают работы). В облако и в код переноса выбор не уходит; на другом ПК его нет —
 * кнопка у сборки скажет «нужно выбрать цель».
 *
 * Модуль без зависимостей от окна: хранилище — параметр (`globalThis.localStorage`).
 */

export const BUILD_CHOICES_KEY = "astral.build-choices.v1";

/* Потолок хранилища: выбор — десятки байт на вещь, но человек может собрать сотни вещей; выбросим самые давние сборки, а не весь ключ. */
const CEILING = 2000000;

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const attempt = (job) => {
  try {
    job();
    return true;
  } catch {
    return false;
  }
};

function loadRows(storage) {
  let parsed = null;
  attempt(() => {
    parsed = JSON.parse(storage.getItem(BUILD_CHOICES_KEY));
  });
  return isRecord(parsed) ? parsed : {};
}

/* Пишет карту целиком; не влезло или отказало — выбрасывает самые давние сборки с головы. Итог: записалось ли. */
function commit(storage, rows) {
  const keys = Object.keys(rows);
  for (let evicted = 0; evicted <= keys.length; evicted += 1) {
    const json = JSON.stringify(rows);
    if (
      json.length <= CEILING &&
      attempt(() => storage.setItem(BUILD_CHOICES_KEY, json))
    )
      return true;
    if (evicted < keys.length) Reflect.deleteProperty(rows, keys[evicted]);
  }
  attempt(() => storage.removeItem(BUILD_CHOICES_KEY));
  return false;
}

/** Запомнить выборы сборки (`{ [id мода]: clothingChoice }`); пусто или `null` — забыть. Итог: легло ли в хранилище. */
export function rememberBuildChoices(
  profileId,
  choices,
  storage = globalThis.localStorage,
) {
  if (!profileId || !storage) return false;
  const rows = loadRows(storage);
  Reflect.deleteProperty(rows, profileId);
  if (isRecord(choices) && Object.keys(choices).length)
    rows[profileId] = choices;
  return (
    commit(storage, rows) &&
    (!rows[profileId] || Boolean(loadRows(storage)[profileId]))
  );
}

/** Сборку удалили — её выборы тоже. */
export function forgetBuildChoices(
  profileId,
  storage = globalThis.localStorage,
) {
  if (!profileId || !storage) return;
  const rows = loadRows(storage);
  if (profileId in rows) {
    Reflect.deleteProperty(rows, profileId);
    commit(storage, rows);
  }
}

/** Список сборок с выборами из хранилища; запись без своих выборов остаётся как есть. Не список — как пришло. */
export function withStoredChoices(profiles, storage = globalThis.localStorage) {
  if (!Array.isArray(profiles) || !storage) return profiles;
  const rows = loadRows(storage);
  if (!Object.keys(rows).length) return profiles;
  return profiles.map((profile) =>
    isRecord(rows[profile?.id])
      ? { ...profile, choices: rows[profile.id] }
      : profile,
  );
}

/** Запись сборки для хранилища сборок: выборы уходят в свой ключ, в `modovik-builds` не дублируются. */
export function withoutChoices(profile) {
  if (!isRecord(profile) || !("choices" in profile)) return profile;
  const copy = { ...profile };
  delete copy.choices;
  return copy;
}
