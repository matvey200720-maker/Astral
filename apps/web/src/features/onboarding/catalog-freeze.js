// Каталог сеанса не меняется на глазах (владелец, 16.11.2026): «каталог обновляется только после перезапуска приложения; пока оно открыто, место в нём не сбивается».
// Главный процесс присылает окну каталог не один раз: сначала запомненный (или первые страницы), потом свежий событием, потом ещё после входа или смены доступа.
// Окно кладёт в показ первый каталог сеанса, а следующие откладывает: на диске свежий каталог уже лежит (главный процесс пишет его до события), и следующий запуск откроется с ним.
// Здесь — чистые правила; ход каталога по сеансу ведёт `useCloudSession.js`.

/** Источник пустого каталога, который главный процесс присылает, когда каталог аккаунту закрыт (`CLOSED_CLOUD_CATALOG` в `apps/desktop/src/cloud-catalog.js`). */
export const CLOSED_CATALOG_SOURCE = "astral-catalog-closed";

/**
 * Можно ли положить пришедший каталог в показ.
 *
 * Да, когда:
 *  - каталог без номера (`revision`): локальный API и песочница, не главный процесс, — как и раньше;
 *  - в окне ещё нет целого каталога: первый каталог сеанса, включая первые страницы (`partial`) и каталог, что пришёл уже после старта;
 *  - в окне пустой каталог (закрытый, гостя): доступ мог открыться, и откладывать нечего;
 *  - пришёл закрытый каталог: доступ отозван, окно не должно продолжать показывать то, что человеку уже нельзя;
 *  - сменился аккаунт (вход, выход): прежний каталог был про другого человека (`thawed`).
 * Иначе каталог откладывается до перезапуска.
 */
export function mayShowCatalog({
  catalog,
  shownComplete,
  shownEmpty = false,
  thawed = false,
}) {
  if (!Number.isFinite(Number(catalog?.revision))) return true;
  if (!shownComplete) return true;
  if (shownEmpty || thawed) return true;
  return catalog.source === CLOSED_CATALOG_SOURCE;
}

/** Каталог пуст: ни одного мода (закрытый каталог, гость). */
export const isEmptyCatalog = (catalog) => !catalog?.mods?.length;

/*
 * Что у мода говорит о его пакете: какой манифест, откуда качать, подписан ли, какой версии. Установка берёт это из каталога в тот миг, когда человек нажал «Установить»
 * (`install` в `DesktopShell.jsx`); у каталога v2 пакета в списке нет, и грант с манифестом приходит от облака в тот же миг, а у старого каталога (v1) и у песочницы манифест лежит в самой записи.
 */
export const PACKAGE_FIELDS = Object.freeze([
  "manifest",
  "packageBaseUrl",
  "packageStatus",
  "mirrors",
  "delivery",
  "sizeBytes",
  "formattedSize",
  "version",
  "artifactSha256",
  "signingKeyId",
]);

/**
 * Мод для установки: видимая запись, а пакет — из отложенного каталога, если там мод уже новее. Видимый список не трогается, ставится свежий пакет, а не тот, что был на старте.
 * Полей пакета у свежей записи нет — их нет и у результата (не остаётся ни прежнего манифеста при новой ссылке, ни наоборот). Отложенной записи нет — возвращается тот же объект.
 */
export function withFreshPackage(mod, fresh) {
  if (!mod || !fresh || fresh === mod) return mod;
  /* Замена и набор тату ставятся не пакетом самой записи, а пакетом под выбранную вещь: их пакет не трогаем. */
  if (mod.clothingChoice || mod.tattooSetChoice || mod.batch) return mod;
  let changed = false;
  const next = { ...mod };
  for (const field of PACKAGE_FIELDS) {
    if (field in fresh) {
      if (next[field] !== fresh[field]) changed = true;
      next[field] = fresh[field];
    } else if (field in next) {
      delete next[field];
      changed = true;
    }
  }
  return changed ? next : mod;
}
