// Запись «откуда пришла установка»: окно отправляет её движку вместе с пакетом,
// а список «Что стоит в игре» по ней группирует вещи.

const MOD_ID_LIMIT = 128;

const isAsciiAlnum = (code) =>
  (code >= 48 && code <= 57) ||
  (code >= 65 && code <= 90) ||
  (code >= 97 && code <= 122);

// точка, подчёркивание, дефис
const isIdSeparator = (code) => code === 46 || code === 95 || code === 45;

// Правило то же, что у движка в stage-package.js: менять только вместе с ним.
function isCatalogModId(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MOD_ID_LIMIT
  )
    return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (isAsciiAlnum(code)) continue;
    if (i === 0 || !isIdSeparator(code)) return false;
  }
  return true;
}

const stringOrEmpty = (value) => (typeof value === "string" ? value : "");

export function installOrigin(item) {
  const entry = item ?? {};
  const bundleId = entry.bundleId;
  // Идентификатор сборки окно не проверяет: это делает движок.
  const origin = bundleId
    ? {
        bundleId,
        source: "build",
        buildId: bundleId,
        buildName: stringOrEmpty(entry.bundleName),
      }
    : { source: "catalog" };
  origin.title = stringOrEmpty(entry.name);
  const modId = entry.id;
  if (isCatalogModId(modId)) origin.catalogModId = modId;
  /* Релиз мода каталога, с которого ставили: после обновления игры по нему видно, что в каталоге вышла новая версия (А10, шаг 3). */
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(entry.releaseId || ""))) origin.releaseId = entry.releaseId;
  return origin;
}

/**
 * Какой сборке или паку принадлежит ставящаяся часть: поля `bundleId`/`bundleName` строки очереди (по ним `installOrigin` пишет `origin.bundleId`).
 * Явный `options.bundle` («Повторить» у части сборки) — как есть. Иначе часть остаётся там, где стояла: в записи, что стоит сейчас (`bundleOf`: «Установить» на карточке ствола), или в записи, что ждёт
 * новой версии после проверки файлов игры (`removed`, причина `waiting-for-version`: «Обновить» в «Библиотеке» и тихая попытка `useWaitingUpdates`). Без этого обновлённый ствол пака выпадал из пака (22.11.2026).
 * @param {object} mod карточка мода каталога
 * @param {{ bundle?: { id: string, name?: string } }} options параметры установки оболочки
 * @param {{ bundleOf?: object, removed?: object[], mods?: object[] }} state «id записи → id сборки», снятые проверкой файлов, каталог
 */
export function bundleFieldsOf(mod, options = {}, state = {}) {
  const bundle = options?.bundle;
  if (bundle?.id) return { bundleId: bundle.id, bundleName: bundle.name };
  const { bundleOf = {}, removed = [], mods = [] } = state ?? {};
  const waiting = (removed ?? []).find((item) => item?.reason === "waiting-for-version" && item?.origin?.bundleId && (item.origin.catalogModId || item.modId) === mod?.id);
  const bundleId = (mod?.id && Object.hasOwn(bundleOf, mod.id) && bundleOf[mod.id]) || waiting?.origin.bundleId || "";
  if (!bundleId) return {};
  return { bundleId, bundleName: stringOrEmpty(mods.find((item) => item?.id === bundleId)?.name) || stringOrEmpty(waiting?.origin.buildName) };
}
