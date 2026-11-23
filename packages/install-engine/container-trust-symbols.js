/*
 * Символы доверия контейнерных форм (GTA 5 RP, 20.11.2026): дороги, растительность и места через контейнер в `update.rpf`, и пакетная форма растительности. Отдельный крошечный файл: символы
 * нужны `local-trust.js` и `mayStoreByLink` СРАЗУ (старт главного процесса), а сами строгие проверки форм (`*-container-manifest-trust.js`, `vegetation-manifest-trust.js`) тяжёлые и в стартовый
 * граф не входят. Какой файл и какая функция отвечают символу, знает только внутренняя таблица `local-trust.js` (наружу не отдаётся); грузит проверку `loadContainerTrust(символ)`, её зовёт
 * обёртка установки (`local-packages.js`). Регистрации проверок снаружи нет. Не загружено — символ не засчитывается (закрыто по умолчанию).
 */
export { LOCAL_VEGETATION_TRUST } from "./vegetation-ids.js";
export const LOCAL_ROADS_CONTAINER_TRUST = Symbol("local-roads-container-package");
export const LOCAL_VEGETATION_CONTAINER_TRUST = Symbol("local-vegetation-container-package");
export const LOCAL_PLACES_CONTAINER_TRUST = Symbol("local-places-container-package");
export const LOCAL_ROADS_CARRIER_TRUST = Symbol("local-roads-carrier-package");
export const LOCAL_VEGETATION_CARRIER_TRUST = Symbol("local-vegetation-carrier-package");
