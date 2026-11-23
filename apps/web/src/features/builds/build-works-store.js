import { normalizeBuildWorks } from "./build-works-model.js";
import { withStoredChoices, withoutChoices } from "./build-choices-store.js";

const CEILING = 4000000;

export const BUILD_WORKS_KEY = "astral.build-works.v1";

const hasWorks = (profile) => profile?.works?.length > 0 && Array.isArray(profile.works);

const withoutWorks = (profile) => {
  const copy = { ...profile };
  delete copy.works;
  return copy;
};

// Успех действия над хранилищем: любой отказ (нет хранилища, исключение, квота) даёт false.
function ok(job) {
  try {
    job();
    return true;
  } catch {
    return false;
  }
}

function loadRows(storage) {
  let parsed = null;
  ok(() => {
    parsed = JSON.parse(storage.getItem(BUILD_WORKS_KEY));
  });
  return {}.toString.call(parsed) === "[object Object]" ? parsed : {};
}

// Пишет карту целиком, не влезло или отказало — выбрасывает самые давние сборки с головы.
// Результат: сколько сборок вытеснено, -1 — не записалось и ключ убран.
function commitRows(storage, rows) {
  const keys = Object.keys(rows);
  for (let evicted = 0; evicted < keys.length; evicted += 1) {
    const json = JSON.stringify(rows);
    if (json.length <= CEILING && ok(() => storage.setItem(BUILD_WORKS_KEY, json))) return evicted;
    Reflect.deleteProperty(rows, keys[evicted]);
  }
  ok(() => storage.removeItem(BUILD_WORKS_KEY));
  return keys.length ? -1 : 0;
}

/* Работы и выборы цели одежды лежат в своих ключах (`rememberBuildWorks`, `build-choices-store.js`), в списке сборок не дублируются. */
export const persistProfiles = (key, profiles, storage = globalThis.localStorage) =>
  ok(() => storage.setItem(key, JSON.stringify(Array.isArray(profiles) ? profiles.map((profile) => withoutChoices(withoutWorks(profile))) : [])));

export const migrateBuildWorks = (profiles, storage = globalThis.localStorage) => {
  if (storage && Array.isArray(profiles)) {
    const taken = loadRows(storage);
    profiles.filter(hasWorks).forEach((profile) => {
      if (taken[profile.id]) return;
      rememberBuildWorks(profile.id, profile.works, storage);
      taken[profile.id] = true;
    });
  }
};

/* Список сборок с работами и выборами цели одежды из хранилища: оболочка зовёт одну эту функцию и для своих, и для облачных сборок. */
export const withStoredWorks = (profiles, storage = globalThis.localStorage) => {
  const rows = Array.isArray(profiles) ? loadRows(storage) : null;
  const withWorks = rows
    ? profiles.map((profile) => (hasWorks(profile) || !rows[profile?.id] ? profile : { ...withoutWorks(profile), works: normalizeBuildWorks(rows[profile.id]) }))
    : [];
  return withStoredChoices(withWorks, storage);
};

export const forgetBuildWorks = (profileId, storage = globalThis.localStorage) => {
  if (profileId && storage) {
    const rows = loadRows(storage);
    if (profileId in rows) {
      Reflect.deleteProperty(rows, profileId);
      commitRows(storage, rows);
    }
  }
};

export const rememberBuildWorks = (profileId, works, storage = globalThis.localStorage) => {
  if (!(profileId && storage)) return false;
  const list = normalizeBuildWorks(works);
  const rows = loadRows(storage);
  Reflect.deleteProperty(rows, profileId);
  if (list.length) rows[profileId] = list;
  return commitRows(storage, rows) === 0 && (!list.length || Boolean(loadRows(storage)[profileId]));
};
