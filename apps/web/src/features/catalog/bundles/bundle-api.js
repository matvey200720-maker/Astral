/*
 * Вызовы движка из рабочих модулей сборки — лениво (11.11.2026, разбор тестов движка).
 *
 * `api.js` — общий вход окна к рабочему столу, и по цепочке он тянет мост песочницы (`qa-desktop-bridge.js` → `dev/*`), у которого в разработке есть `import.meta.env`. Рабочие
 * модули сборки (`bundle-install.js`, `batch-install.js`) читают под обычным Node тесты движка (`tests/install-bench.test.js`): статический `import … from "api.js"` ронял их
 * на `import.meta.env.DEV`. Здесь `api.js` берётся динамическим импортом в момент вызова: в окне он уже загружен (общий вход), в тесте под Node его нет, пока вызов не нужен.
 * Сторож — `tests/bundles-node-safe.test.js`: в статическом графе модулей `features/catalog/bundles/` нет `api.js`, `qa-*` и `dev/`.
 */

const api = () => import("../../../api.js");

/** Ссылка на скачивание пакета с облака (`getCloudDownloadGrant` общего входа). */
export const getCloudDownloadGrant = async (...args) => (await api()).getCloudDownloadGrant(...args);

/** План установки пакета на игру (`planLocalPackage`). */
export const planLocalPackage = async (...args) => (await api()).planLocalPackage(...args);

/** Список спорных файлов последнего отказа «оставить своё или заменить» (`readForeignConflicts`); `null`, если моста нет. */
export const readForeignConflicts = async (...args) => (await api()).readForeignConflicts(...args);

/** Ход пачки: одна транзакция движка (`installRemotePackages`). */
export const installRemotePackages = async (...args) => (await api()).installRemotePackages(...args);
